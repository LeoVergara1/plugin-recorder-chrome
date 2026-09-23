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
  'mute microphone',
  'silenciar micr',
  'desativar micro',
  'désactiver le micro',
  'mikrofon aus',
  'mikrofon deaktivieren',
  'disattiva il micro',
];
const MIC_OFF_HINTS = [
  'activar micr',
  'reactivar micr',
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
// Racha de chequeos seguidos sin UI de llamada. El DOM de Meet se reconstruye
// al entrar/salir (transiciones de segundos), asi que solo se declara el fin
// tras varios chequeos seguidos: un solo negativo era un falso positivo que
// detenia la grabacion a los pocos segundos de empezarla.
let notInCallStreak = 0;
const ENDED_AFTER_STREAK = 3;

function looksLikeInCall(): boolean {
  const labels = Array.from(document.querySelectorAll('button')).map((b) =>
    (b.getAttribute('aria-label') || '').toLowerCase(),
  );
  return labels.some((l) => LEAVE_HINTS.some((h) => l.includes(h)));
}

// Diagnostico bajo demanda desde el popup (MEET_QUERY): devuelve el estado
// detectado mas una muestra de etiquetas reales para ampliar variantes.
function collectStatus(): { inCall: boolean; micOpen: boolean | null; labels: string[] } {
  const labels = Array.from(document.querySelectorAll('button'))
    .map((b) => (b.getAttribute('aria-label') || '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 40);
  return { inCall: looksLikeInCall(), micOpen: meetMicOpen(), labels };
}

chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === 'MEET_QUERY') {
    sendResponse({ ok: true, data: collectStatus() });
  }
  return false;
});

window.setInterval(() => {
  try {
    const inCall = looksLikeInCall();
    if (inCall) {
      wasInCall = true;
      notInCallStreak = 0;
    } else if (wasInCall && !endedSent && document.querySelectorAll('button').length > 0) {
      notInCallStreak += 1;
      if (notInCallStreak >= ENDED_AFTER_STREAK) {
        endedSent = true;
        void chrome.runtime.sendMessage({ type: 'MEET_ENDED' }).catch(() => undefined);
      }
    } else {
      notInCallStreak = 0;
    }
    // Estado del micro: se reporta siempre que sea determinado (sin gatear
    // por inCall: si la deteccion de llamada falla en un idioma, el mute
    // seguiria funcionando igual).
    const micOpen = meetMicOpen();
    if (micOpen !== null && micOpen !== lastMicOpen) {
      lastMicOpen = micOpen;
      void chrome.runtime.sendMessage({ type: 'MEET_MIC', muted: !micOpen }).catch(() => undefined);
    }
  } catch {
    // noop: nunca romper la pagina de Meet por este detector
  }
}, 2000);
