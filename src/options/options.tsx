import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Quality, RecorderDefaults } from '../lib/types';
import { DEFAULT_DEFAULTS } from '../lib/types';
import { loadDefaults, saveDefaults } from '../lib/defaults';

// Pagina de opciones: valores por defecto (mic, calidad, auto-split).
// Se aplican al iniciar cada grabacion; cambiarlos no afecta a la sesion en curso.

const SPLIT_CHOICES = [
  { value: 0, label: 'Desactivado' },
  { value: 15, label: 'Cada 15 min' },
  { value: 30, label: 'Cada 30 min (recomendado)' },
  { value: 60, label: 'Cada 60 min' },
];

function Options() {
  const [d, setD] = useState<RecorderDefaults>({ ...DEFAULT_DEFAULTS });
  const [saved, setSaved] = useState(false);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    void loadDefaults().then(setD);
  }, []);

  async function persist(next: RecorderDefaults) {
    setD(next);
    await saveDefaults(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  // Lista los microfonos disponibles. Requiere conceder el permiso una vez;
  // sin el, los nombres salen vacios. Importante si Meet usa un micro
  // distinto al del sistema: aqui puedes fijar el mismo.
  async function detectDevices() {
    setScanning(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of s.getTracks()) t.stop();
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((m) => m.kind === 'audioinput')
          .map((m) => ({ deviceId: m.deviceId, label: m.label })),
      );
    } catch {
      setDevices([]);
    } finally {
      setScanning(false);
    }
  }

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '24px auto', padding: '0 16px' }}>
      <h1>Opciones – Tab Recorder</h1>

      <label style={row}>
        <input
          type="checkbox"
          checked={d.includeMic}
          onChange={(e) => persist({ ...d, includeMic: e.target.checked })}
        />
        Incluir microfono por defecto
      </label>

      <label style={row}>
        <input
          type="checkbox"
          checked={d.respectMeetMute}
          onChange={(e) => persist({ ...d, respectMeetMute: e.target.checked })}
        />
        Respetar el mute de Meet (no grabar mi micro mientras este muteado en Meet)
      </label>

      <label style={row}>
        Calidad por defecto
        <select value={d.quality} onChange={(e) => persist({ ...d, quality: e.target.value as Quality })}>
          <option value="720p">720p (recomendado)</option>
          <option value="1080p">1080p</option>
        </select>
      </label>

      <div style={row}>
        <button onClick={detectDevices} disabled={scanning}>
          {scanning ? 'Detectando…' : 'Detectar micrófonos'}
        </button>
        <select
          value={d.micDeviceId ?? ''}
          disabled={devices.length === 0}
          onChange={(e) => persist({ ...d, micDeviceId: e.target.value || null })}
        >
          <option value="">Micrófono del sistema</option>
          {devices.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Micrófono ${m.deviceId.slice(0, 6)}…`}
            </option>
          ))}
        </select>
      </div>
      {devices.length === 0 && (
        <p style={{ fontSize: 13, color: '#5f6368' }}>
          Si tu voz no queda en las grabaciones, pulsa «Detectar micrófonos» y elige el mismo
          micro que usas en Meet.
        </p>
      )}

      <label style={row}>
        Dividir grabaciones largas
        <select
          value={d.splitMinutes}
          onChange={(e) => persist({ ...d, splitMinutes: Number(e.target.value) })}
        >
          {SPLIT_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {saved && <p style={{ color: '#137333' }}>Guardado.</p>}

      <hr style={{ margin: '20px 0' }} />
      <p style={{ fontSize: 13, color: '#5f6368' }}>
        Las grabaciones quedan solo en tu equipo (descargas locales, sin nube ni bots).
        Avisa a los participantes y graba unicamente con su consentimiento.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Options />);
