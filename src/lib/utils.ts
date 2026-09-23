import type { Quality, RecordingState } from './types';

export function buildFilename(prefix = 'tab-rec', part = 1): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
  return `${prefix}-${stamp}-p${part}.webm`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Tiempo grabado efectivo: descuenta lo acumulado en pausa. */
export function computeElapsedMs(s: RecordingState, now: number): number {
  if (!s.startedAt) return 0;
  let ms = now - s.startedAt - s.pausedTotalMs;
  if (s.paused && s.pauseStartedAt) ms -= now - s.pauseStartedAt;
  return Math.max(0, ms);
}

export function qualityConstraints(quality: Quality): {
  maxWidth: number;
  maxHeight: number;
  maxFrameRate: number;
} {
  return quality === '1080p'
    ? { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 }
    : { maxWidth: 1280, maxHeight: 720, maxFrameRate: 30 };
}

export function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}
