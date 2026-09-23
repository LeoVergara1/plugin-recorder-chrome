import { STORAGE_KEY, type RecordingState } from './types';

// --- Estado en chrome.storage.local (leido por popup y SW) ---

export const DEFAULT_STATE: RecordingState = {
  isRecording: false,
  paused: false,
  startedAt: null,
  pausedTotalMs: 0,
  pauseStartedAt: null,
  tabId: null,
  includeMic: true,
  quality: '720p',
  partIndex: 1,
  lastError: null,
  micIncluded: null,
  micLabel: null,
  meetMuted: null,
};

export async function loadState(): Promise<RecordingState> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const s = data[STORAGE_KEY] as RecordingState | undefined;
  return s ?? { ...DEFAULT_STATE };
}

export async function saveState(s: RecordingState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: s });
}

// --- Chunks en IndexedDB (recuperacion tras crash/cierre) ---
//
// El offscreen guarda cada chunk aqui ademas de en memoria. Si el
// navegador se cierra a mitad de grabacion, viewer.html puede
// recomponer el video parcial.

const DB_NAME = 'tab-recorder';
const STORE = 'chunks';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearChunks(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function appendChunk(chunk: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(chunk);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function readAllChunks(): Promise<Blob[]> {
  const db = await openDb();
  try {
    return await new Promise<Blob[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as Blob[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
