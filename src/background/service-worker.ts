// Service worker (MV3): orquesta la grabacion.
//
// Flujo:
// 1. Popup envia START (gesto del usuario, requerido por tabCapture).
// 2. Se crea el offscreen document si no existe.
// 3. Se obtiene el streamId con chrome.tabCapture.getMediaStreamId.
// 4. Se reenvia al offscreen, que corre MediaRecorder.
// 5. STOP (o cierre de pestana / fin de Meet) detiene y limpia estado.

import {
  KEEPALIVE_ALARM,
  SPLIT_ALARM,
  SPLIT_MINUTES,
  STORAGE_KEY,
  type ContentToSW,
  type OffscreenToSW,
  type PopupToSW,
  type Quality,
} from '../lib/types';
import { DEFAULT_STATE, loadState, saveState } from '../lib/storage';

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({});
  const exists = contexts.some((c) => c.contextType === 'OFFSCREEN_DOCUMENT');
  if (exists) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Grabar la pestana activa con chrome.tabCapture (video + audio)',
  });
}

function getTabStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(streamId);
    });
  });
}

function setBadge(recording: boolean): void {
  void chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  if (recording) void chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}

async function handleStart(includeMic: boolean, quality: Quality): Promise<{ ok: boolean; error?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return { ok: false, error: 'No hay pestana activa para grabar.' };

  await ensureOffscreen();

  let streamId: string;
  try {
    streamId = await getTabStreamId(tab.id);
  } catch (e) {
    return { ok: false, error: `No se pudo capturar la pestana: ${e instanceof Error ? e.message : String(e)}` };
  }

  await saveState({
    isRecording: true,
    paused: false,
    startedAt: Date.now(),
    pausedTotalMs: 0,
    pauseStartedAt: null,
    tabId: tab.id,
    includeMic,
    quality,
    partIndex: 1,
  });
  setBadge(true);
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  await chrome.alarms.create(SPLIT_ALARM, { periodInMinutes: SPLIT_MINUTES });

  await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_START',
    streamId,
    includeMic,
    quality,
    tabId: tab.id,
    partIndex: 1,
  });
  return { ok: true };
}

async function forwardToOffscreen(msg: object): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // El offscreen puede no existir; el estado ya quedo persistido.
  }
}

async function handlePause(): Promise<{ ok: boolean }> {
  const s = await loadState();
  if (!s.isRecording || s.paused) return { ok: true };
  await saveState({ ...s, paused: true, pauseStartedAt: Date.now() });
  await forwardToOffscreen({ type: 'OFFSCREEN_PAUSE' });
  return { ok: true };
}

async function handleResume(): Promise<{ ok: boolean }> {
  const s = await loadState();
  if (!s.isRecording || !s.paused) return { ok: true };
  const now = Date.now();
  await saveState({
    ...s,
    paused: false,
    pausedTotalMs: s.pausedTotalMs + (s.pauseStartedAt ? now - s.pauseStartedAt : 0),
    pauseStartedAt: null,
  });
  await forwardToOffscreen({ type: 'OFFSCREEN_RESUME' });
  return { ok: true };
}

async function handleStop(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
  } catch {
    // El offscreen puede no existir; igual limpiamos estado.
  }
  await saveState({ ...DEFAULT_STATE });
  setBadge(false);
  await chrome.alarms.clear(KEEPALIVE_ALARM);
  await chrome.alarms.clear(SPLIT_ALARM);
}

chrome.runtime.onMessage.addListener(
  (msg: PopupToSW | OffscreenToSW | ContentToSW, _sender, sendResponse) => {
    (async () => {
      switch (msg.type) {
        case 'GET_STATE': {
          sendResponse({ ok: true, state: await loadState() });
          break;
        }
        case 'START': {
          sendResponse(await handleStart(msg.includeMic, msg.quality));
          break;
        }
        case 'STOP': {
          await handleStop();
          sendResponse({ ok: true });
          break;
        }
        case 'PAUSE': {
          sendResponse(await handlePause());
          break;
        }
        case 'RESUME': {
          sendResponse(await handleResume());
          break;
        }
        case 'RECORDING_STARTED': {
          const s = await loadState();
          await saveState({ ...s, isRecording: true });
          setBadge(true);
          break;
        }
        case 'RECORDING_SPLIT': {
          const s = await loadState();
          await saveState({ ...s, partIndex: msg.part, paused: false });
          break;
        }
        case 'RECORDING_STOPPED':
        case 'RECORDING_ERROR': {
          await saveState({ ...DEFAULT_STATE });
          setBadge(false);
          await chrome.alarms.clear(KEEPALIVE_ALARM);
          await chrome.alarms.clear(SPLIT_ALARM);
          break;
        }
        case 'MEET_ENDED': {
          const s = await loadState();
          if (s.isRecording) await handleStop();
          break;
        }
      }
    })();
    return true; // respuesta asincrona
  },
);

// Auto-stop si se cierra la pestana que se estaba grabando.
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const s = await loadState();
    if (s.isRecording && s.tabId === tabId) await handleStop();
  })();
});

// Keepalive: despertar al SW periodicamente durante grabaciones largas.
// Split: cada SPLIT_MINUTES se cierra la parte actual y sigue la siguiente.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    void chrome.storage.local.get(STORAGE_KEY);
  } else if (alarm.name === SPLIT_ALARM) {
    void (async () => {
      const s = await loadState();
      // Si esta pausado se omite este tick; el siguiente parte la grabacion.
      if (s.isRecording && !s.paused) {
        await forwardToOffscreen({ type: 'OFFSCREEN_SPLIT' });
      }
    })();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void saveState({ ...DEFAULT_STATE });
  setBadge(false);
});
