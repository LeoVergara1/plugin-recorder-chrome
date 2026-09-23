# Plan – Plugin Chrome para grabar Meet sin ser percibido (estilo scre.io)

> Carpeta: `/Users/brandonvergara/MyProjects/plugin-recorder-chrome`
> Fecha: 2026-09-23
> Estado: Plan inicial – sin código aún

## 1. Objetivo

Construir una extensión de Chrome (Manifest V3) que permita a **un participante local** grabar una sesión de Google Meet (video + audio de la pestaña + micrófono opcional) **sin unirse como un participante/bot extra y sin activar el indicador “Recording” de Meet**, al estilo de `scre.io`.

### 1.1 Qué significa “sin ser percibido” (aclaración técnica honesta)

Esto es clave para no diseñar mal el proyecto:

1.  **Lo que SÍ podemos lograr (como scre.io):**
    *   Grabación **local** con `chrome.tabCapture` + `MediaRecorder`. Esto es captura a nivel de pestaña del navegador.
    *   Meet no lo detecta como “grabación” porque no usamos la API de Meet ni entramos como bot. Para los demás participantes **no aparece ningún participante extra ni el punto rojo de “REC” de Meet**.
    *   El archivo queda local (Downloads / IndexedDB) o se sube a donde decidamos.

2.  **Lo que NO significa:**
    *   No es 100% invisible en tu propia máquina: Chrome muestra un indicador azul nativo de “esta pestaña está siendo capturada” y, si usas `getDisplayMedia`, muestra el diálogo de compartir. Con `tabCapture` iniciado por gesto del usuario evitamos el diálogo, pero el indicador azul de la pestaña sigue ahí (solo lo ves tú).
    *   No podemos grabar un Meet en el que no participas sin estar en la pestaña. Para grabar sin estar presente necesitarías un **bot** (Playwright/Puppeteer en servidor), y ese bot **siempre será visible** como participante.
    *   No podemos ocultar la grabación a nivel legal/ético: hay que incluir consentimiento/aviso y cumplir normativa local.

**Decisión de arquitectura para este proyecto:** enfoque **local-first, sin bot**, igual que scre.io y que extensiones como “Meet Recorder” / “tl;dv bot-free mode”.

Si más adelante quieres grabación en la nube sin estar presente, será **Fase 2** con bot visible (no sigiloso).

## 2. Cómo lo hace scre.io (modelo a replicar)

Investigación (scre.io, Chrome docs, muestras `tabcapture-recorder`):

*   No se une al Meet. Corre donde ya estás tú.
*   Usa `chrome.tabCapture.getMediaStreamId({ targetTabId })` desde el `service worker` (Chrome 116+) tras un gesto del usuario (click en el icono / botón “Grabar”).
*   Pasa ese `streamId` a un **Offscreen Document** (`chrome.offscreen.createDocument` con `reasons: ['USER_MEDIA']` o `DISPLAY_MEDIA`), porque el `service worker` no tiene DOM ni puede correr `MediaRecorder` de forma estable.
*   En el offscreen hace `navigator.mediaDevices.getUserMedia` con `chromeMediaSource: "tab"` y graba con `MediaRecorder` (WebM VP9 + Opus).
*   Mezcla audio de pestaña + micrófono con `AudioContext` (`createMediaStreamSource` + `MediaStreamDestination`) si se quiere incluir tu voz.
*   Reproduce el audio localmente (`source.connect(context.destination)`) para que no se silencie la pestaña durante la captura.
*   Al detener, genera un Blob, lo guarda (descarga / `chrome.downloads` / IndexedDB por chunks) y cierra la captura.

Referencias base:
*   `https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture`
*   Ejemplo `sample.tabcapture-recorder` y repo `aoyilmaz/silent-screen-recorder` / `prokopsimek/chrome-extension-recording`

## 3. Alcance MVP (v0.1)

**In:**
*   Popup con: Iniciar / Detener, indicador tiempo, selector mic ON/OFF, selector calidad.
*   Solo pestaña activa de Meet (`meet.google.com`). Validar URL antes de grabar.
*   Graba video pestaña (hasta 1080p si da) + audio pestaña + mic opcional en **un solo .webm**.
*   El recording sigue aunque cambies de pestaña (offscreen), termina si cierras la pestaña de Meet.
*   Descarga automática al detener + página `recording.html` para preview/descargar si falla.
*   Badge “REC” en icono + contador.

**Out (no MVP):**
*   Transcripción, speaker labels, resúmenes IA.
*   Subida a nube / Drive / S3.
*   Bot en servidor, dashboard, multi-tab, Firefox/Safari.
*   Anotaciones sobre Meet.

## 4. Arquitectura propuesta (Manifest V3, Chrome 116+)

```
plugin-recorder-chrome/
├── PLAN.md                 <- este archivo
├── README.md
├── package.json            <- solo dev (vite/ts, lint, zip)
├── src/
│   ├── manifest.json       <- se genera o es estático
│   ├── background/
│   │   └── service-worker.js  <- orquesta: gesto -> getMediaStreamId -> offscreen -> estado
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.js       <- getUserMedia(tab) + getUserMedia(mic) + AudioContext mix + MediaRecorder
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── content/
│   │   └── meet-detector.js   <- detecta que estás en Meet, estado llamada, auto-stop al salir
│   ├── recorder-page/
│   │   └── viewer.html        <- fallback para reproducir/guardar blob largo
│   └── lib/
│       ├── mixer.js
│       ├── storage.js         <- IndexedDB por chunks para sesiones >1h
│       └── utils.js
├── icons/
└── dist/                   <- build para Load unpacked / Web Store
```

### Componentes y responsabilidades

1.  **`manifest.json` (V3)**
    ```json
    {
      "manifest_version": 3,
      "permissions": ["tabCapture", "offscreen", "activeTab", "tabs", "storage", "alarms", "downloads"],
      "host_permissions": ["https://meet.google.com/*"],
      "background": { "service_worker": "background/service-worker.js" },
      "action": { "default_popup": "popup/popup.html" },
      "content_scripts": [{
        "matches": ["https://meet.google.com/*"],
        "js": ["content/meet-detector.js"]
      }]
    }
    ```
    *   `tabCapture`: núcleo.
    *   `offscreen`: correr MediaRecorder en background.
    *   `alarms`: keepalive del service worker en grabaciones largas (cada ~25s).
    *   `storage`: persistir estado `isRecording`, `startedAt`, settings.

2.  **Service Worker (`background/`)**
    *   Escucha `chrome.action.onClicked` o mensaje `start-recording` del popup (gesto usuario requerido).
    *   `chrome.offscreen.createDocument({ url: 'offscreen/offscreen.html', reasons: ['USER_MEDIA'], justification: 'Recording tabCapture' })` si no existe.
    *   `chrome.tabCapture.getMediaStreamId({ targetTabId })` -> envía a offscreen.
    *   Gestiona `chrome.tabCapture.onStatusChanged`, `chrome.tabs.onRemoved` para auto-stop.
    *   Keepalive con `chrome.alarms`.

3.  **Offscreen Document (`offscreen/`)**
    *   Recibe `streamId`, hace:
        ```js
        navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
          video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }
        })
        ```
    *   Si mic ON: `getUserMedia({ audio: true })` paralelo + mix con `AudioContext`.
    *   Importante: reconectar audio al destino para no mutear al usuario.
    *   `MediaRecorder` con `mimeType: 'video/webm;codecs=vp9,opus'` fallback a `vp8`/`webm`.
    *   `ondataavailable` -> guardar chunks en memoria + IndexedDB cada X seg para no perder todo si crashea.
    *   Mensajes: `start-recording`, `stop-recording`, `pause`, `resume`.

4.  **Popup (`popup/`)**
    *   UI mínima: estado, tiempo, toggle mic, calidad (720p/1080p), botón start/stop.
    *   No grabar desde el popup directamente (se cierra y pierde foco) – solo manda mensajes al SW.

5.  **Content Script (`meet-detector.js`)**
    *   Solo detección: ¿estoy en llamada? ¿cuántos participantes? ¿se acabó la call?
    *   Envía evento `MEET_ENDED` para auto-detener y guardar.
    *   No inyecta botones en el MVP (para minimizar detección visual / roturas con cambios de DOM de Meet).

## 5. Flujo de grabación (feliz + bordes)

**Feliz:**
1. Usuario abre Meet -> click icono extensión -> Popup “Listo para grabar esta pestaña”.
2. Click “Grabar” -> SW crea offscreen -> `getMediaStreamId` -> offscreen inicia MediaRecorder -> SW guarda `{ recording: true, tabId }` -> badge REC.
3. Usuario habla/escucha normal. Puede cambiar de pestaña; la captura sigue ligada a `tabId` de Meet.
4. Click “Detener” -> offscreen `stop()` -> compone Blob -> `chrome.downloads.download({ filename: meet-YYYY-MM-DD-HHmm.webm })` -> limpia offscreen/contextos -> badge off.

**Bordes a manejar:**
*   Cierras pestaña Meet -> auto-stop + guardar parcial + notificación.
*   Meet hace throttle si estás en otra pestaña: el video puede congelarse / audio silenciarse en ese intervalo. Mitigación: avisar en UI “mantén Meet visible para mejor calidad” y documentarlo. No hay fix perfecto con `tabCapture`.
*   Mic no permitido en offscreen: pedir permiso antes (página `permissions.html` que pide `getUserMedia` una vez) o capturar mic desde popup-less flow con fallback a solo audio pestaña.
*   Grabaciones >1-2h: no guardar todo en RAM. Guardar chunks en IndexedDB y componer al final, o descargas parciales cada 30 min.
*   Navegación dentro de la pestaña: `tabCapture` sobrevive a navegaciones, pero si sales de Meet hay que detener.

## 6. Stack técnico recomendado

*   **Sin framework para MVP:** Vanilla JS + ES modules. Menos fricción con SW/offscreen. Migrar a TS + Vite en v0.2 si crece.
*   Dev: `Node 20`, `web-ext` o script `zip` simple para empaquetar `dist/`.
*   Formato: WebM (nativo). Conversión a MP4 opcional post (ffmpeg.wasm o servidor) – no MVP.
*   QA manual: `chrome://extensions` -> Load unpacked.

## 7. Plan de trabajo por fases

**Fase 0 – Setup (0.5 día)**
*   [ ] Crear `src/manifest.json`, icons placeholder, `README` con instrucciones Load unpacked.
*   [ ] Estructura carpetas de §4.

**Fase 1 – Núcleo grabación (2-3 días)**
*   [ ] SW + offscreen + `getMediaStreamId` + MediaRecorder básico (solo pestaña, sin mic).
*   [ ] Popup start/stop + badge + timer.
*   [ ] Descarga .webm + viewer fallback.
*   [ ] Criterio éxito: grabar YouTube 30s y Meet de prueba 2 min, archivo reproducible.

**Fase 2 – Audio mixto + robustez (2-3 días)**
*   [x] Mix tab+mic con AudioContext, toggle mic, no mutear pestaña.
*   [x] Keepalive alarms, persistencia storage, auto-stop al cerrar Meet.
*   [x] Chunks a IndexedDB + recuperación tras crash.
*   [x] Selector calidad, pause/resume (timer descuenta pausas).
*   [x] Extra: preflight de permiso de mic en el popup + auto-split cada 30 min (`-p1`, `-p2`…).

**Fase 3 – Pulido Meet (1-2 días)**
*   [x] Content script detector (multi-idioma + vuelta a home), validación URL, aviso “mantén visible la pestaña”.
*   [x] Manejo errores UX: páginas no capturables, errores humanizados, `lastError` persistente visible en popup.
*   [x] Iconos finales (PNG 16/32/48/128 generados), página de opciones (defaults mic/calidad/split), consentimiento en popup + opciones.

**Fase 4 – Publicación (1 día + review Google)**
*   [ ] Privacy policy, screenshots, descripción Web Store, justificación permisos `tabCapture`.
*   [ ] Zip `dist/`, subir a dev dashboard.

**Fase 5 (futuro, fuera de este plan) – Nube/IA**
*   Bot con Playwright si se quiere grabar sin estar presente (visible), upload S3, transcripción Whisper, resumen.

## 8. Riesgos y decisiones abiertas

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Google cambia DOM de Meet | Content script se rompe | Mantener detector mínimo, no depender de selectores frágiles |
| Throttling al cambiar de pestaña | Gaps en video/audio | Avisar en UI, recomendar ventana separada |
| Offscreen no puede capturar mic + tab a la vez en algunas versiones | Sin voz propia | Probar en Chrome Stable 120+; fallback a solo-tab; rama `tabcapture-mic` de samples como ref |
| Archivo enorme / OOM | Pérdida grabación | Chunks + IndexedDB desde Fase 2 |
| Rechazo Web Store por “stealth recording” | No publicable | Descripción honesta: “local meeting capture”, + consentimiento explícito + privacy policy; no prometer “undetectable” en listing |
| Tema legal | Grabación sin consentimiento ilegal en muchas jurisdicciones | Banner “Avisa a los participantes / obtén consentimiento”, setting de beep/anuncio opcional |

**Decisiones tomadas (2026-09-23):**
1. Cualquier pestaña (no solo Meet).
2. Micrófono activado por defecto + siempre el audio de la pestaña (mezcla con `AudioContext`).
3. Solo descarga local (sin nube en v0.1).
4. TypeScript + React + Vite.
5. Solo video por ahora (sin transcripción).
6. Git inicializado en la raíz (`main`, con `.gitignore` + `.nvmrc` → Node 20).

**Estado (Fase 0 + 1 + 2 + 3 completas, verificado con `npm run typecheck` + `npm run build`):**
*   `src/manifest.json`, `src/background/service-worker.ts`, `src/offscreen/` (pause/resume/split),
    `src/popup/` (React + preflight mic + defaults), `src/options/`, `src/icons/`,
    `src/content/tab-detector.ts`, `src/recorder-page/viewer.tsx`, `src/lib/`.
    `dist/` plano y coherente con el manifest.
*   Pendiente: pruebas en Meet real, privacy policy / Web Store.

## Fix mic (2026-09-23): “se escucha a los demás pero no mi voz”

Causa raíz: el audio de los demás viene de la pestaña (siempre se captura bien);
tu voz viene de un `getUserMedia` de mic separado. Si ese mic falla (permiso
denegado, dispositivo equivocado, mic del SO), la extensión seguía grabando
solo-pestaña **en silencio**: el popup se cerraba y nadie se enteraba.
*   Medidor de nivel en vivo (`MIC_LEVEL` desde el offscreen) + botón **Probar micrófono**.
*   Estado `micIncluded` real: el popup muestra «Mic en mezcla» + nivel, o aviso si no quedó incluido.
*   Si el mic falla al iniciar, el popup **ya no se cierra**: muestra el aviso y ofrece «Grabar sin micrófono».
*   Selector de dispositivo en opciones (para cuando Meet usa otro micro que el del sistema).
*   Guía de diagnóstico en `README` (incl. permiso de mic en macOS).

## 9. Siguiente paso inmediato

Probar en Chrome (`chrome://extensions` → Load unpacked → `dist/`): grabar una pestaña
cualquiera 30s y un Meet de prueba 2 min, verificar que el `.webm` incluye video +
audio de pestaña + mic, y que al cerrar la pestaña hace auto-stop.

---
*Nota ética: esta herramienta es para grabar reuniones donde participas y con consentimiento de los demás. No usar para espionaje.*
