// Tipos de mensajes y estado compartidos entre
// popup <-> service worker <-> offscreen <-> content.

export type Quality = '720p' | '1080p';

export interface RecorderDefaults {
  includeMic: boolean;
  quality: Quality;
  /** Minutos entre partes (0 = sin auto-split). */
  splitMinutes: number;
  /** deviceId de microfono elegido (null = dispositivo del sistema). */
  micDeviceId: string | null;
  /** Si true (Meet), la pista del micro se silencia al mutear en Meet. */
  respectMeetMute: boolean;
}

export const DEFAULT_DEFAULTS: RecorderDefaults = {
  includeMic: true,
  quality: '720p',
  splitMinutes: 30,
  micDeviceId: null,
  respectMeetMute: true,
};

export interface RecordingState {
  isRecording: boolean;
  paused: boolean;
  startedAt: number | null;
  /** Milisegundos acumulados en pausa (para que el timer no cuente pausas). */
  pausedTotalMs: number;
  pauseStartedAt: number | null;
  tabId: number | null;
  includeMic: boolean;
  quality: Quality;
  /** Parte actual (auto-split cada SPLIT_MINUTES). */
  partIndex: number;
  /** Ultimo error asincrono (se muestra al abrir el popup). */
  lastError: string | null;
  /** null = sin dato; true/false = microfono realmente en la mezcla. */
  micIncluded: boolean | null;
  /** null = sin dato (o no es Meet); true = muteado en Meet. */
  meetMuted: boolean | null;
}

// Popup -> Service Worker
export type PopupToSW =
  | { type: 'GET_STATE' }
  | { type: 'START'; includeMic: boolean; quality: Quality }
  | { type: 'STOP' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CLEAR_ERROR' }
  | { type: 'TEST_MIC_START' }
  | { type: 'TEST_MIC_STOP' };

// Service Worker -> Offscreen
export type SWToOffscreen =
  | { type: 'OFFSCREEN_START'; streamId: string; includeMic: boolean; quality: Quality; tabId: number; partIndex: number; deviceId: string | null; meetMuted: boolean | null }
  | { type: 'OFFSCREEN_STOP' }
  | { type: 'OFFSCREEN_PAUSE' }
  | { type: 'OFFSCREEN_RESUME' }
  | { type: 'OFFSCREEN_SPLIT' }
  | { type: 'OFFSCREEN_MEET_MIC'; muted: boolean }
  | { type: 'OFFSCREEN_TEST_START'; deviceId: string | null }
  | { type: 'OFFSCREEN_TEST_STOP' };

// Offscreen -> Service Worker
export type OffscreenToSW =
  | { type: 'RECORDING_STARTED'; micIncluded: boolean }
  | { type: 'RECORDING_STOPPED'; filename: string }
  | { type: 'RECORDING_SPLIT'; filename: string; part: number }
  | { type: 'RECORDING_ERROR'; message: string }
  | { type: 'MIC_LEVEL'; level: number; hasTrack: boolean; trackMuted: boolean; trackState: string; context: 'rec' | 'test' };

// Content (Meet) -> Service Worker
export type ContentToSW = { type: 'MEET_ENDED' } | { type: 'MEET_MIC'; muted: boolean };

export const STORAGE_KEY = 'recorder:state';
export const DEFAULTS_KEY = 'recorder:defaults';
export const KEEPALIVE_ALARM = 'recorder-keepalive';
export const SPLIT_ALARM = 'recorder-split';
export const SPLIT_MINUTES = 30;
