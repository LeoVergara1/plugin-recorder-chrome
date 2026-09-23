import { useCallback, useEffect, useState } from 'react';
import type { Quality, RecordingState } from '../lib/types';
import { DEFAULT_STATE } from '../lib/storage';
import { computeElapsedMs, formatElapsed } from '../lib/utils';

// Pide el permiso de microfono en el popup (gesto del usuario) antes de
// iniciar, para que el offscreen lo tenga concedido. Devuelve true si OK.
async function ensureMicPermission(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of s.getTracks()) t.stop();
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [state, setState] = useState<RecordingState>({ ...DEFAULT_STATE });
  const [now, setNow] = useState<number>(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (res?.state) setState(res.state as RecordingState);
    } catch {
      // SW dormido o popup sin contexto; se reintenta en el siguiente tick.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reloj + sincronizacion de estado mientras graba.
  useEffect(() => {
    if (!state.isRecording) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.isRecording, refresh]);

  async function handleStart() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let includeMic = state.includeMic;
      if (includeMic && !(await ensureMicPermission())) {
        includeMic = false;
        setState((s) => ({ ...s, includeMic: false }));
        setNotice('Microfono denegado: se grabara solo el audio de la pestana.');
      }
      const res = await chrome.runtime.sendMessage({
        type: 'START',
        includeMic,
        quality: state.quality,
      });
      if (!res?.ok) {
        setError(res?.error ?? 'No se pudo iniciar la grabacion.');
      } else {
        // Cerrar el popup evita que el cambio de foco interfiera con la captura.
        window.close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function sendQuiet(type: 'STOP' | 'PAUSE' | 'RESUME') {
    setBusy(true);
    setError(null);
    try {
      await chrome.runtime.sendMessage({ type });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  function openViewer() {
    void chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
  }

  const elapsed = formatElapsed(computeElapsedMs(state, now));

  return (
    <div className="wrap">
      <header className="head">
        <span className={`dot ${state.isRecording ? 'rec' : 'idle'}`} />
        <h1>Tab Recorder</h1>
        {state.isRecording && <span className="timer">{elapsed}</span>}
      </header>

      <p className="hint">
        {state.isRecording
          ? `Grabando esta pestana${state.partIndex > 1 ? ` (parte ${state.partIndex})` : ''}${
              state.paused ? ' — en pausa.' : '.'
            }`
          : 'Graba la pestana activa. Queda en local, sin bots ni participantes extra.'}
      </p>

      <label className="row">
        <input
          type="checkbox"
          checked={state.includeMic}
          disabled={state.isRecording || busy}
          onChange={(e) => setState((s) => ({ ...s, includeMic: e.target.checked }))}
        />
        Incluir mi microfono (por defecto activado)
      </label>

      <label className="row">
        Calidad
        <select
          value={state.quality}
          disabled={state.isRecording || busy}
          onChange={(e) => setState((s) => ({ ...s, quality: e.target.value as Quality }))}
        >
          <option value="720p">720p (recomendado)</option>
          <option value="1080p">1080p</option>
        </select>
      </label>

      {state.isRecording ? (
        <div className="btn-row">
          {state.paused ? (
            <button className="btn start" disabled={busy} onClick={() => sendQuiet('RESUME')}>
              Reanudar
            </button>
          ) : (
            <button className="btn secondary" disabled={busy} onClick={() => sendQuiet('PAUSE')}>
              Pausar
            </button>
          )}
          <button className="btn stop" disabled={busy} onClick={() => sendQuiet('STOP')}>
            {busy ? 'Deteniendo…' : 'Detener y descargar'}
          </button>
        </div>
      ) : (
        <button className="btn start" disabled={busy} onClick={handleStart}>
          {busy ? 'Iniciando…' : 'Grabar esta pestana'}
        </button>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <footer className="foot">
        <button className="link" onClick={openViewer}>
          Abrir recuperador de grabacion
        </button>
        <p className="consent">Avisa a los participantes y graba solo con su consentimiento.</p>
      </footer>
    </div>
  );
}
