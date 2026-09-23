// Mezcla el audio de la pestana con el microfono en un AudioContext.
//
// Dos detalles importantes:
// 1. El audio de la pestana se reinyecta al destino local para que
//    la pestana NO se silencie mientras se captura.
// 2. Todo corre en el offscreen document (el service worker no tiene DOM
//    ni AudioContext estable).

export interface MixResult {
  /** Stream con la(s) pista(s) de audio mezcladas. */
  mixedStream: MediaStream;
  context: AudioContext;
  stop: () => void;
}

export function mixTabAndMic(tabStream: MediaStream, micStream: MediaStream | null): MixResult {
  const context = new AudioContext();
  const dest = context.createMediaStreamDestination();

  const tabAudio = tabStream.getAudioTracks();
  if (tabAudio.length > 0) {
    const tabSource = context.createMediaStreamSource(new MediaStream(tabAudio));
    tabSource.connect(dest);
    // Mantener audible la pestana para el usuario local.
    tabSource.connect(context.destination);
  }

  if (micStream) {
    const micSource = context.createMediaStreamSource(micStream);
    micSource.connect(dest);
  }

  void context.resume().catch(() => undefined);

  return {
    mixedStream: dest.stream,
    context,
    stop: () => {
      void context.close().catch(() => undefined);
    },
  };
}

/** Combina el video de la pestana con el audio ya mezclado. */
export function combineVideoWithMixedAudio(tabStream: MediaStream, mixedAudio: MediaStream): MediaStream {
  const out = new MediaStream();
  for (const t of tabStream.getVideoTracks()) out.addTrack(t);
  for (const t of mixedAudio.getAudioTracks()) out.addTrack(t);
  return out;
}
