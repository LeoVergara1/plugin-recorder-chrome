// Offscreen document: aqui vive el MediaRecorder.
//
// El service worker no tiene DOM/AudioContext, por eso la captura real
// ocurre aqui: getUserMedia(tab) + getUserMedia(mic) -> mix -> grabar.
// Al detener, descarga el .webm localmente (requisito: solo local).
//
// Fase 2: pause/resume (MediaRecorder.pause/resume) y auto-split cada
// 30 min (el SW envia OFFSCREEN_SPLIT): se cierra la parte actual,
// se descarga `...-pN.webm` y se sigue grabando en `...-pN+1.webm`
// con los mismos streams, sin perder la sesion.

import type { Quality, SWToOffscreen } from '../lib/types';
import { appendChunk, clearChunks } from '../lib/storage';
import { combineVideoWithMixedAudio, mixTabAndMic } from '../lib/mixer';
import { buildFilename, pickMimeType, qualityConstraints } from '../lib/utils';

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let mixStop: (() => void) | null = null;
let liveStreams: MediaStream[] = [];
let outputStream: MediaStream | null = null;
let recording = false;
let partIndex = 1;
let splitting = false;

async function getTabStream(streamId: string, quality: Quality): Promise<MediaStream> {
  const q = qualityConstraints(quality);
  const constraints = {
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: q.maxWidth,
        maxHeight: q.maxHeight,
        maxFrameRate: q.maxFrameRate,
      },
    },
  } as unknown as MediaStreamConstraints;
  return navigator.mediaDevices.getUserMedia(constraints);
}

function cleanup(): void {
  recording = false;
  recorder = null;
  chunks = [];
  outputStream = null;
  partIndex = 1;
  splitting = false;
  mixStop?.();
  mixStop = null;
  for (const s of liveStreams) {
    for (const t of s.getTracks()) {
      try {
        t.stop();
      } catch {
        // noop
      }
    }
  }
  liveStreams = [];
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function startRecorder(): void {
  if (!outputStream) throw new Error('Sin stream de salida para grabar.');
  const mimeType = pickMimeType();
  recorder = new MediaRecorder(
    outputStream,
    mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : undefined,
  );
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
      void appendChunk(e.data).catch(() => undefined);
    }
  };
  recorder.onstop = () => {
    void onRecorderStop();
  };
  recorder.start(1000);
}

async function onRecorderStop(): Promise<void> {
  const wasSplit = splitting;
  splitting = false;
  try {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const filename = buildFilename('tab-rec', partIndex);
    downloadBlob(blob, filename);
    // Cada parte descargada libera su respaldo: el recuperador solo
    // reconstruye la parte en curso.
    await clearChunks().catch(() => undefined);

    if (wasSplit && outputStream) {
      // Continuar la sesion en una parte nueva con los mismos streams.
      chunks = [];
      partIndex += 1;
      startRecorder();
      await chrome.runtime.sendMessage({ type: 'RECORDING_SPLIT', filename, part: partIndex });
      return;
    }
    await chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED', filename });
  } catch (e) {
    await chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    if (!wasSplit || !outputStream) cleanup();
  }
}

async function start(streamId: string, includeMic: boolean, quality: Quality, startPart: number): Promise<void> {
  if (recording) return;
  try {
    await clearChunks();
    chunks = [];
    partIndex = startPart;

    const tabStream = await getTabStream(streamId, quality);
    liveStreams.push(tabStream);

    let micStream: MediaStream | null = null;
    if (includeMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        liveStreams.push(micStream);
      } catch {
        // Sin permiso de microfono: seguimos solo con el audio de la pestana.
        micStream = null;
      }
    }

    const mixed = mixTabAndMic(tabStream, micStream);
    mixStop = mixed.stop;
    outputStream = combineVideoWithMixedAudio(tabStream, mixed.mixedStream);

    startRecorder();
    recording = true;
    await chrome.runtime.sendMessage({ type: 'RECORDING_STARTED', micIncluded: micStream !== null });
  } catch (e) {
    cleanup();
    await chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function stop(): Promise<void> {
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  } else {
    cleanup();
  }
}

function pause(): void {
  if (recorder && recorder.state === 'recording') {
    try {
      recorder.pause();
    } catch {
      // noop: si no se puede pausar, la grabacion sigue
    }
  }
}

function resume(): void {
  if (recorder && recorder.state === 'paused') {
    try {
      recorder.resume();
    } catch {
      // noop
    }
  }
}

function split(): void {
  if (recording && recorder && recorder.state === 'recording' && !splitting) {
    splitting = true;
    try {
      recorder.stop(); // onRecorderStop() continuara en la parte siguiente
    } catch {
      splitting = false;
    }
  }
}

chrome.runtime.onMessage.addListener((msg: SWToOffscreen) => {
  switch (msg.type) {
    case 'OFFSCREEN_START':
      void start(msg.streamId, msg.includeMic, msg.quality, msg.partIndex);
      break;
    case 'OFFSCREEN_STOP':
      void stop();
      break;
    case 'OFFSCREEN_PAUSE':
      pause();
      break;
    case 'OFFSCREEN_RESUME':
      resume();
      break;
    case 'OFFSCREEN_SPLIT':
      split();
      break;
  }
});
