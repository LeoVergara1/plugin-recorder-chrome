// Offscreen document: aqui vive el MediaRecorder.
//
// El service worker no tiene DOM/AudioContext, por eso la captura real
// ocurre aqui: getUserMedia(tab) + getUserMedia(mic) -> mix -> grabar.
// Al detener, descarga el .webm localmente (requisito: solo local).
//
// Fase 2: pause/resume y auto-split.
// Fix mic: medidor de nivel en vivo (MIC_LEVEL) + modo de prueba
// (OFFSCREEN_TEST_*) + seleccion de dispositivo, para que un microfono
// silencioso/equivocado nunca pase desapercibido.

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
// Pistas del micro de la sesion: se habilitan/deshabilitan segun el mute de Meet.
let micTracks: MediaStreamTrack[] = [];
let meetMuted = false;

// --- Medidor de nivel del microfono ---

interface Meter {
  level: () => number;
  trackInfo: () => { hasTrack: boolean; muted: boolean; state: string };
  dispose: () => void;
}

let meter: Meter | null = null;
let meterContext: 'rec' | 'test' | null = null;
let meterTimer: number | null = null;
let testStream: MediaStream | null = null;
let testTimeout: number | null = null;

function micConstraints(deviceId: string | null): MediaStreamConstraints {
  return deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
}

function attachMeter(stream: MediaStream, context: 'rec' | 'test'): void {
  detachMeter();
  const track = stream.getAudioTracks()[0];
  if (!track) {
    void chrome.runtime.sendMessage({
      type: 'MIC_LEVEL',
      level: 0,
      hasTrack: false,
      trackMuted: false,
      trackState: 'missing',
      context,
    });
    return;
  }
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser); // sin conectar a destination: no suena, solo mide
  void ctx.resume().catch(() => undefined);
  const buf = new Float32Array(analyser.fftSize);
  meter = {
    level: () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.min(1, Math.sqrt(sum / buf.length) * 3);
    },
    trackInfo: () => ({ hasTrack: track.readyState === 'live', muted: track.muted, state: track.readyState }),
    dispose: () => {
      try {
        src.disconnect();
      } catch {
        // noop
      }
      void ctx.close().catch(() => undefined);
    },
  };
  meterContext = context;
  meterTimer = window.setInterval(() => {
    if (!meter || !meterContext) return;
    const info = meter.trackInfo();
    void chrome.runtime.sendMessage({
      type: 'MIC_LEVEL',
      level: info.hasTrack && !info.muted ? meter.level() : 0,
      hasTrack: info.hasTrack,
      trackMuted: info.muted,
      trackState: info.state,
      context: meterContext,
    });
  }, 500);
}

function detachMeter(): void {
  if (meterTimer !== null) {
    window.clearInterval(meterTimer);
    meterTimer = null;
  }
  meter?.dispose();
  meter = null;
  meterContext = null;
}

// --- Captura ---

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

function stopTracks(streams: MediaStream[]): void {
  for (const s of streams) {
    for (const t of s.getTracks()) {
      try {
        t.stop();
      } catch {
        // noop
      }
    }
  }
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
  micTracks = [];
  meetMuted = false;
  stopTracks(liveStreams);
  liveStreams = [];
  detachMeter();
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

async function start(
  streamId: string,
  includeMic: boolean,
  quality: Quality,
  startPart: number,
  deviceId: string | null,
  initialMeetMuted: boolean | null,
): Promise<void> {
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
        micStream = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId));
        liveStreams.push(micStream);
      } catch {
        // Sin microfono: seguimos solo con el audio de la pestana, pero
        // avisamos (micIncluded=false) para que el popup lo muestre.
        micStream = null;
      }
    }

    const mixed = mixTabAndMic(tabStream, micStream);
    mixStop = mixed.stop;
    outputStream = combineVideoWithMixedAudio(tabStream, mixed.mixedStream);

    micTracks = micStream ? micStream.getAudioTracks() : [];
    setMeetMuted(initialMeetMuted === true);

    if (micStream) attachMeter(micStream, 'rec');

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

// Sigue al mute de Meet: con el micro muteado en Meet, la pista se
// deshabilita (silencio en la mezcla, sin cortar la grabacion).
function setMeetMuted(muted: boolean): void {
  meetMuted = muted;
  for (const t of micTracks) t.enabled = !muted;
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

// --- Modo prueba de microfono (sin grabar) ---

async function testMicStart(deviceId: string | null): Promise<void> {
  testMicStop();
  try {
    testStream = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId));
    attachMeter(testStream, 'test');
    // Auto-corte por seguridad: la prueba no debe quedar abierta.
    testTimeout = window.setTimeout(() => testMicStop(), 30_000);
  } catch (e) {
    void chrome.runtime.sendMessage({
      type: 'MIC_LEVEL',
      level: 0,
      hasTrack: false,
      trackMuted: false,
      trackState: e instanceof Error ? e.name : 'error',
      context: 'test',
    });
  }
}

function testMicStop(): void {
  if (testTimeout !== null) {
    window.clearTimeout(testTimeout);
    testTimeout = null;
  }
  if (testStream) {
    stopTracks([testStream]);
    testStream = null;
  }
  if (meterContext === 'test') detachMeter();
}

chrome.runtime.onMessage.addListener((msg: SWToOffscreen) => {
  switch (msg.type) {
    case 'OFFSCREEN_START':
      void start(msg.streamId, msg.includeMic, msg.quality, msg.partIndex, msg.deviceId, msg.meetMuted);
      break;
    case 'OFFSCREEN_STOP':
      testMicStop();
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
    case 'OFFSCREEN_MEET_MIC':
      setMeetMuted(msg.muted);
      break;
    case 'OFFSCREEN_TEST_START':
      void testMicStart(msg.deviceId);
      break;
    case 'OFFSCREEN_TEST_STOP':
      testMicStop();
      break;
  }
});
