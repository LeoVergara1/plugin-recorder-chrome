import { useCallback, useEffect, useState } from 'react';
import type { Quality, RecordingState } from '../lib/types';
import { DEFAULT_STATE } from '../lib/storage';
import { loadDefaults } from '../lib/defaults';
import { computeElapsedMs, formatElapsed, humanizeError } from '../lib/utils';

interface MicLevel {
  level: number;
  hasTrack: boolean;
  trackMuted: boolean;
  trackState: string;
  context: 'rec' | 'test';
}

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

function Meter({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="meter" title={`Nivel de microfono: ${pct}%`}>
      <div className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<RecordingState>({ ...DEFAULT_STATE });
  const [now, setNow] = useState<number>(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [micLevel, setMicLevel] = useState<MicLevel | null>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (res?.state) setState(res.state as RecordingState);
    } catch {
      // SW dormido o popup sin contexto; se reintenta en el siguiente tick.
    }
  }, []);

  // Niveles de microfono en vivo (los envia el offscreen).
  useEffect(() => {
    const listener = (msg: { type?: string }) => {
      if (msg?.type === 'MIC_LEVEL') setMicLevel(msg as MicLevel);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Al cerrar el popup, cortar una prueba de mic en curso.
  useEffect(() => {
    return () => {
      void chrome.runtime.sendMessage({ type: 'TEST_MIC_STOP' }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    // Al abrir en reposo, aplicar los defaults de la pagina de opciones.
    void (async () => {
      await refresh();
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        const s = res?.state as RecordingState | undefined;
        if (s && !s.isRecording) {
          const d = await loadDefaults();
          setState({ ...s, includeMic: d.includeMic, quality: d.quality });
        }
      } catch {
        // noop
      }
    })();
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
        // No cerrar: el usuario debe ver que el mic fallo y decidir.
        includeMic = false;
        setMicDenied(true);
        setState((s) => ({ ...s, includeMic: false }));
        setNotice('Microfono denegado o sin acceso: revisa el permiso del navegador. Puedes grabar sin el o reintentar.');
        setBusy(false);
        return;
      }
      const res = await chrome.runtime.sendMessage({
        type: 'START',
        includeMic,
        quality: state.quality,
      });
      if (!res?.ok) {
        setError(humanizeError(res?.error ?? 'No se pudo iniciar la grabacion.'));
      } else {
        // Cerrar el popup evita que el cambio de foco interfiera con la captura.
        window.close();
      }
    } catch (e) {
      setError(humanizeError(e instanceof Error ? e.message : String(e)));
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
      setError(humanizeError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function toggleTest() {
    if (testing) {
      setTesting(false);
      setMicLevel(null);
      try {
        await chrome.runtime.sendMessage({ type: 'TEST_MIC_STOP' });
      } catch {
        // noop
      }
      return;
    }
    setTesting(true);
    setMicLevel(null);
    setError(null);
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_MIC_START' });
    } catch (e) {
      setError(humanizeError(e instanceof Error ? e.message : String(e)));
      setTesting(false);
    }
  }

  async function dismissLastError() {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_ERROR' });
    } catch {
      // noop
    }
    setState((s) => ({ ...s, lastError: null }));
  }

  function openViewer() {
    void chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
  }

  function openOptions() {
    void chrome.runtime.openOptionsPage();
  }

  const elapsed = formatElapsed(computeElapsedMs(state, now));
  const recLevel = micLevel?.context === 'rec' ? micLevel : null;
  const testLevel = micLevel?.context === 'test' ? micLevel : null;

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
            } Manten visible la pestana grabada para evitar huecos.`
          : 'Graba la pestana activa. Queda en local, sin bots ni participantes extra.'}
      </p>

      {state.isRecording && state.meetMuted === true && state.micIncluded !== false && (
        <p className="notice">Silenciado en Meet: tu micro no entra en la grabacion. Se reanuda al activar el micro en Meet.</p>
      )}

      {state.isRecording && (
        <div className="micline">
          {state.micIncluded === false ? (
            <span className="mic-bad">Mic NO incluido en esta grabacion (solo audio de pestana).</span>
          ) : (
            <>
              <span className="mic-ok">Mic en mezcla</span>
              {state.micLabel && (
                <span className="mic-dim" title={state.micLabel}>
                  {state.micLabel.length > 32 ? `${state.micLabel.slice(0, 32)}…` : state.micLabel}
                </span>
              )}
              {recLevel ? (
                <>
                  <Meter value={recLevel.level} />
                  {recLevel.trackMuted && <span className="mic-bad">silenciado a nivel sistema</span>}
                </>
              ) : (
                <span className="mic-dim">midiendo… habla para verificar</span>
              )}
            </>
          )}
        </div>
      )}

      <label className="row">
        <input
          type="checkbox"
          checked={state.includeMic}
          disabled={state.isRecording || busy}
          onChange={(e) => {
            setMicDenied(false);
            setNotice(null);
            setState((s) => ({ ...s, includeMic: e.target.checked }));
          }}
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

      {!state.isRecording && (
        <div className="micline">
          <button className="btn secondary" disabled={busy} onClick={toggleTest}>
            {testing ? 'Detener prueba' : 'Probar microfono'}
          </button>
          {testing && testLevel && <Meter value={testLevel.level} />}
          {testing && testLevel && !testLevel.hasTrack && (
            <span className="mic-bad">sin acceso al mic ({testLevel.trackState})</span>
          )}
          {testing && testLevel?.trackMuted && <span className="mic-bad">silenciado a nivel sistema</span>}
        </div>
      )}

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
          {busy ? 'Iniciando…' : micDenied ? 'Grabar sin microfono' : 'Grabar esta pestana'}
        </button>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {!state.isRecording && state.lastError && (
        <p className="error">
          Ultimo error: {humanizeError(state.lastError)}{' '}
          <button className="link" onClick={dismissLastError}>
            descartar
          </button>
        </p>
      )}

      <footer className="foot">
        <button className="link" onClick={openViewer}>
          Abrir recuperador de grabacion
        </button>
        <button className="link" onClick={openOptions}>
          Opciones (microfono, calidad, auto-split)
        </button>
        <p className="consent">Avisa a los participantes y graba solo con su consentimiento.</p>
      </footer>
    </div>
  );
}
