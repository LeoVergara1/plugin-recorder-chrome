import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearChunks, readAllChunks } from '../lib/storage';
import { buildFilename } from '../lib/utils';

// Pagina de recuperacion: si el navegador se cerro a mitad de grabacion,
// los chunks quedaron en IndexedDB y aqui se pueden recomponer,
// previsualizar y descargar.

function Viewer() {
  const [url, setUrl] = useState<string | null>(null);
  const [info, setInfo] = useState('Busca fragmentos guardados de una grabacion interrumpida.');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const chunks = await readAllChunks();
      if (chunks.length === 0) {
        setInfo('No hay fragmentos guardados.');
        setUrl(null);
        return;
      }
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (url) URL.revokeObjectURL(url);
      setUrl(URL.createObjectURL(blob));
      setInfo(`${chunks.length} fragmentos (~${(blob.size / 1048576).toFixed(1)} MB).`);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = buildFilename('tab-recuperada');
    a.click();
  }

  async function clear() {
    await clearChunks();
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    setInfo('Fragmentos eliminados.');
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
      <h1>Recuperador de grabacion</h1>
      <p>{info}</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={load} disabled={busy}>
          {busy ? 'Buscando…' : 'Buscar fragmentos'}
        </button>
        <button onClick={download} disabled={!url}>
          Descargar video
        </button>
        <button onClick={clear} disabled={busy}>
          Borrar fragmentos
        </button>
      </div>
      {url && <video src={url} controls style={{ width: '100%', borderRadius: 8 }} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Viewer />);
