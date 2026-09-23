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

// Boton de microfono de Meet: el aria-label cambia segun el estado.
// Se chequean las etiquetas de "micro abierto" PRIMERO porque
// "desactivar micrófono" contiene como subcadena "activar micr".
const MIC_ON_HINTS = [
  'desactivar micr',
  'turn off microphone',
  'desativar micro',
  'désactiver le micro',
  'mikrofon aus',
  'mikrofon deaktivieren',
  'disattiva il micro',
];
const MIC_OFF_HINTS = [
  'activar micr',
  'turn on microphone',
  'unmute',
  'ativar micro',
  'activer le micro',
  'mikrofon einschalten',
  'mikrofon aktivieren',
  'attiva il micro',
];

// true = micro abierto en Meet, false = muteado, null = indeterminado.
function meetMicOpen(): boolean | null {
  const labels = Array.from(document.querySelectorAll('button')).map((b) =>
    (b.getAttribute('aria-label') || '').toLowerCase(),
  );
  if (labels.some((l) => MIC_ON_HINTS.some((h) => l.includes(h)))) return true;
  if (labels.some((l) => MIC_OFF_HINTS.some((h) => l.includes(h)))) return false;
  return null;
}

let lastMicOpen: boolean | null = null;

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
    // Estado del micro: solo se avisa cuando cambia y es determinado.
    const micOpen = looksLikeInCall() ? meetMicOpen() : null;
    if (micOpen !== null && micOpen !== lastMicOpen) {
      lastMicOpen = micOpen;
      void chrome.runtime.sendMessage({ type: 'MEET_MIC', muted: !micOpen }).catch(() => undefined);
    }
  } catch {
    // noop: nunca romper la pagina de Meet por este detector
  }
}, 2000);
