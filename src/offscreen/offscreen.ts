// Offscreen document: aqui vive el MediaRecorder.
//
// El service worker no tiene DOM/AudioContext, por eso la captura real
// ocurre aqui: getUserMedia(tab) + getUserMedia(mic) -> mix -> grabar.
// Al detener, descarga el .webm localmente (requisito: solo local).

import type { Quality, SWToOffscreen } from '../lib/types';
import { appendChunk, clearChunks } from '../lib/storage';
import { combineVideoWithMixedAudio, mixTabAndMic } from '../lib/mixer';
import { buildFilename, pickMimeType, qualityConstraints } from '../lib/utils';

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let mixStop: (() => void) | null = null;
let liveStreams: MediaStream[] = [];
let recording = false;

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

async function finishRecording(): Promise<void> {
  try {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const filename = buildFilename();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    await clearChunks().catch(() => undefined);
    await chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED', filename });
  } catch (e) {
    await chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    cleanup();
  }
}

async function start(streamId: string, includeMic: boolean, quality: Quality): Promise<void> {
  if (recording) return;
  try {
    await clearChunks();
    chunks = [];

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
    const output = combineVideoWithMixedAudio(tabStream, mixed.mixedStream);

    const mimeType = pickMimeType();
    recorder = new MediaRecorder(
      output,
      mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : undefined,
    );
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
        void appendChunk(e.data).catch(() => undefined);
      }
    };
    recorder.onstop = () => {
      void finishRecording();
    };
    recorder.start(1000);
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

chrome.runtime.onMessage.addListener((msg: SWToOffscreen) => {
  if (msg.type === 'OFFSCREEN_START') {
    void start(msg.streamId, msg.includeMic, msg.quality);
  } else if (msg.type === 'OFFSCREEN_STOP') {
    void stop();
  }
});
