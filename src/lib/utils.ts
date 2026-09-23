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

/** Traduce errores tecnicos (DOMException, tabCapture) a texto accionable. */
export function humanizeError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('permission denied') || m.includes('notallowederror')) {
    return 'Permiso denegado por el navegador. Revisa el icono de camara/microfono en la barra de direcciones y vuelve a intentar.';
  }
  if (m.includes('notfounderror') || m.includes('requested device not found')) {
    return 'No se encontro microfono o la pestana dejo de estar disponible. Revisa tus dispositivos e intentalo de nuevo.';
  }
  if (m.includes('notsupportederror') || m.includes('not supported')) {
    return 'Este contenido no se puede capturar con el codec disponible. Prueba con otra pestana o calidad.';
  }
  if (m.includes('could not establish connection') || m.includes('receiving end does not exist')) {
    return 'La grabacion se interrumpio (pestana cerrada o extension recargada). Revisa tu carpeta de descargas por si quedo una parte.';
  }
  return raw;
}

/** Las paginas internas del navegador no se pueden capturar con tabCapture. */
export function isCapturableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return !/^(chrome|edge|about|view-source|chrome-extension|devtools|opera|brave):/.test(url);
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
