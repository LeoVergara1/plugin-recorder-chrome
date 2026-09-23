// Tipos de mensajes y estado compartidos entre
// popup <-> service worker <-> offscreen <-> content.

export type Quality = '720p' | '1080p';

export interface RecordingState {
  isRecording: boolean;
  startedAt: number | null;
  tabId: number | null;
  includeMic: boolean;
  quality: Quality;
}

// Popup -> Service Worker
export type PopupToSW =
  | { type: 'GET_STATE' }
  | { type: 'START'; includeMic: boolean; quality: Quality }
  | { type: 'STOP' };

// Service Worker -> Offscreen
export type SWToOffscreen =
  | { type: 'OFFSCREEN_START'; streamId: string; includeMic: boolean; quality: Quality; tabId: number }
  | { type: 'OFFSCREEN_STOP' };

// Offscreen -> Service Worker
export type OffscreenToSW =
  | { type: 'RECORDING_STARTED'; micIncluded: boolean }
  | { type: 'RECORDING_STOPPED'; filename: string }
  | { type: 'RECORDING_ERROR'; message: string };

// Content (Meet) -> Service Worker
export type ContentToSW = { type: 'MEET_ENDED' };

export const STORAGE_KEY = 'recorder:state';
export const KEEPALIVE_ALARM = 'recorder-keepalive';
