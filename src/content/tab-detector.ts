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

// Etiquetas de "colgar/salir" en varios idiomas (el aria-label de Meet
// depende del idioma del usuario). Best-effort: ante la duda no detenemos.
const LEAVE_HINTS = [
  'colgar',
  'abandonar',
  'salir de la llamada',
  'terminar la llamada',
  'leave call',
  'hang up',
  'leave the call',
  'end the call',
  'sair da chamada',
  'encerrar',
];

function looksLikeInCall(): boolean {
  const labels = Array.from(document.querySelectorAll('button')).map((b) =>
    (b.getAttribute('aria-label') || '').toLowerCase(),
  );
  return labels.some((l) => LEAVE_HINTS.some((h) => l.includes(h)));
}

// Salir a la home de Meet (pathname "/") tras estar en llamada tambien
// cuenta como fin de llamada.
function looksLikeHome(): boolean {
  return window.location.pathname === '/' || window.location.pathname === '';
}

window.setInterval(() => {
  try {
    const inCall = looksLikeInCall();
    if (inCall) wasInCall = true;
    if (wasInCall && !inCall && !endedSent && (looksLikeHome() || document.querySelectorAll('button').length > 0)) {
      endedSent = true;
      void chrome.runtime.sendMessage({ type: 'MEET_ENDED' }).catch(() => undefined);
    }
  } catch {
    // noop: nunca romper la pagina de Meet por este detector
  }
}, 3000);
