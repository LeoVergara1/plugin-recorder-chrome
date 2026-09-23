// Detector para Google Meet: auto-detiene la grabacion si el usuario
// abandona la llamada pero mantiene la pestana abierta.
//
// Nota: el cierre de pestana ya lo cubre el service worker
// (chrome.tabs.onRemoved). Esto cubre el caso "cuelgo pero no cierro".
//
// Heuristica intencionalmente conservadora (best-effort): el DOM de Meet
// cambia a menudo, asi que solo observamos la desaparicion de los
// botones tipicos de llamada tras haberlos visto.

let wasInCall = false;
let endedSent = false;

function looksLikeInCall(): boolean {
  const labels = Array.from(document.querySelectorAll('button')).map((b) =>
    (b.getAttribute('aria-label') || '').toLowerCase(),
  );
  return labels.some(
    (l) => l.includes('colgar') || l.includes('abandonar') || l.includes('leave call') || l.includes('hang up'),
  );
}

window.setInterval(() => {
  try {
    const inCall = looksLikeInCall();
    if (inCall) wasInCall = true;
    if (wasInCall && !inCall && !endedSent) {
      endedSent = true;
      void chrome.runtime.sendMessage({ type: 'MEET_ENDED' }).catch(() => undefined);
    }
  } catch {
    // noop: nunca romper la pagina de Meet por este detector
  }
}, 3000);
