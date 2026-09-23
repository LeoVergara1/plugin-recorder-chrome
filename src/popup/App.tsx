import { useCallback, useEffect, useState } from 'react';
import type { Quality, RecordingState } from '../lib/types';
import { DEFAULT_STATE } from '../lib/storage';
import { formatElapsed } from '../lib/utils';

export default function App() {
  const [state, setState] = useState<RecordingState>({ ...DEFAULT_STATE });
  const [now, setNow] = useState<number>(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'START',
        includeMic: state.includeMic,
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

  async function handleStop() {
    setBusy(true);
    setError(null);
    try {
      await chrome.runtime.sendMessage({ type: 'STOP' });
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

  const elapsed = state.startedAt ? formatElapsed(now - state.startedAt) : '00:00';

  return (
    <div className="wrap">
      <header className="head">
        <span className={`dot ${state.isRecording ? 'rec' : 'idle'}`} />
        <h1>Tab Recorder</h1>
        {state.isRecording && <span className="timer">{elapsed}</span>}
      </header>

      <p className="hint">
        {state.isRecording
          ? 'Grabando esta pestana (video + audio pestana + microfono si esta activado).'
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
        <button className="btn stop" disabled={busy} onClick={handleStop}>
          {busy ? 'Deteniendo…' : 'Detener y descargar'}
        </button>
      ) : (
        <button className="btn start" disabled={busy} onClick={handleStart}>
          {busy ? 'Iniciando…' : 'Grabar esta pestana'}
        </button>
      )}

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
