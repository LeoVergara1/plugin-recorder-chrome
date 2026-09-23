# Tab Recorder (local) – Chrome Extension (MV3 + TS + React)

Graba **cualquier pestaña** (Meet, YouTube, etc.) en local: video + audio de la pestaña + micrófono.
Sin bots ni participantes extra. El archivo `.webm` se descarga en tu equipo.

Decisiones del proyecto (2026-09-23):

1. Cualquier pestaña (no solo Meet).
2. Micrófono activado por defecto + siempre el audio de la pestaña.
3. Solo descarga local (sin nube).
4. TypeScript + React.

## Requisitos

- Chrome 116+ (usa Offscreen Document + `tabCapture.getMediaStreamId` en el service worker).
- Node 20 (`nvm use 20` – hay `.nvmrc`).

## Desarrollo

```bash
nvm use 20
npm install
npm run typecheck
npm run build
```

Cargar en Chrome:

1. Abrir `chrome://extensions`, activar _Developer mode_.
2. _Load unpacked_ → seleccionar `dist/`.
3. Ir a cualquier pestaña (p. ej. un Meet) → clic en el icono → **Grabar esta pestaña**.
4. Al detener, el `.webm` se descarga automáticamente.

> Nota: Chrome muestra su indicador azul nativo de captura en la pestaña (solo lo ves tú).
> Para los demás participantes no aparece ningún bot ni aviso de Meet, porque la captura
> es local a tu navegador. Aun así: **avisa y graba solo con consentimiento**.

## Estructura

```
src/
├── manifest.json              # fuente (se copia a dist/ en el build)
├── background/service-worker.ts  # orquesta: gesto -> streamId -> offscreen -> estado
├── offscreen/                 # MediaRecorder + mezcla tab+mic (AudioContext)
├── popup/                     # UI React: start/stop/pause/resume, mic (con preflight de permiso), calidad, timer
├── options/                   # pagina de opciones: defaults de mic, calidad y auto-split
├── icons/                     # iconos PNG (16/32/48/128)
├── content/tab-detector.ts    # auto-stop al colgar en Meet sin cerrar pestaña
├── recorder-page/             # viewer: recompone chunks de IndexedDB tras crash
└── lib/                       # types, mixer, storage (IDB), utils
```

## Limitaciones conocidas

- Si cambias de pestaña, Chrome puede pausar/throttle el render de la pestaña grabada
  (video congelado o huecos). Para mejor calidad, mantén visible la pestaña.
- Cerrar la pestaña grabada termina la captura (auto-stop + descarga parcial).
- Si el micrófono se deniega, se avisa y se sigue grabando solo el audio de la pestaña.
- Grabaciones muy largas se guardan por chunks (1s) en memoria + IndexedDB.
- Auto-split configurable en opciones (15/30/60 min u off): se descarga `...-p1.webm`,
  `...-p2.webm`, etc. sin cortar la sesión. El recuperador solo reconstruye la parte en curso.
- Las paginas internas del navegador (chrome://, Web Store, etc.) no se pueden grabar;
  la extension lo detecta y lo explica antes de intentarlo.
- Los errores de una sesion (p. ej. microfono desconectado a mitad) quedan guardados
  y se muestran al abrir el popup.

## Si tu voz no queda grabada

El audio de los demas viene de la pestana; tu voz viene del microfono que capture
la extension. Si el archivo solo trae a los demas:

1. En el popup pulsa **Probar microfono** y habla: la barra debe moverse.
2. Si no se mueve, abre **Opciones → Detectar micrófonos** y elige el mismo micro
   que usas en Meet (los Bluetooth/USB suelen ser otro dispositivo distinto al del sistema).
3. En macOS revisa `Ajustes del Sistema → Privacidad y seguridad → Micrófono`:
   Chrome debe estar permitido.
4. Durante la grabacion el popup muestra **«Mic en mezcla»** con nivel en vivo,
   o un aviso si el mic no quedo incluido.

## Mute de Meet

Por defecto la extension **respeta el mute de Meet**: si te muteas en la llamada,
tu micro deja de entrar en la grabacion (los demas se siguen escuchando) y se
reanuda al desmutear. El popup lo indica. Puedes desactivarlo en Opciones.
Solo aplica a Google Meet; en otras pestanas el micro siempre queda activo.

## Ruido de fondo

- La extension ya aplica supresión de ruido y eco al micro (Opciones, activado
  por defecto). Si aun hay mucho ruido: usa auriculares (con altavoces el micro
  capta la sala) y acerca el micro.
- El popup muestra **qué micrófono está en la mezcla**. Si es el equivocado
  (p. ej. el del monitor en vez de tus audífonos), cámbialo en
  **Opciones → Detectar micrófonos**.
- El timer descuenta el tiempo en pausa.
