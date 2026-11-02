# PROMPT PARA AGENTE DE IA (terminal) — Crear y TESTEAR “StreamGrab”: extensión multi-navegador que descarga vídeos HLS/DASH/blob como un único MP4

> Copia todo este documento como primer mensaje a tu agente (Claude Code, Codex CLI, Gemini CLI, etc.) en una carpeta vacía.
> Está escrito para que el agente trabaje de forma autónoma, verifique cada paso con herramientas reales y no dé nada por bueno sin pruebas ejecutadas.

---

## 0. ROL Y REGLAS DE TRABAJO

Eres un ingeniero senior de extensiones de navegador y de multimedia (MP4/HLS/DASH). Vas a construir desde cero, en esta carpeta, una extensión llamada **StreamGrab** y su batería de tests. Reglas innegociables:

1. **Nada de “parece que funciona”.** Cada funcionalidad se considera terminada SOLO cuando un test automatizado que tú has ejecutado en esta máquina lo demuestra (ffprobe/ffmpeg para los MP4, un Chromium real para la extensión). Pega las salidas relevantes en tu informe final.
2. Trabaja por **fases con puertas de verificación** (sección 9). No avances a la siguiente fase si la puerta de la actual falla.
3. Si algo no se puede probar aquí (p. ej. Firefox en vivo), **dilo explícitamente** en el informe y prueba lo máximo posible (web-ext lint, build, revisión de APIs). No afirmes lo que no has ejecutado.
4. **Sin DRM.** La extensión debe detectar contenido protegido (Widevine/PlayReady/FairPlay/SAMPLE-AES/ContentProtection) y avisar de que no se puede descargar. Nunca intentes eludirlo.
5. Código en JavaScript moderno (ES modules), sin frameworks en la UI, dependencias mínimas. Comentarios solo donde aporten. Commits pequeños con mensajes claros.
6. Idioma: código y README en inglés (con sección en español); la UI del popup en inglés y español (según `navigator.language`).

## 1. OBJETIVO (qué debe hacer la extensión)

Extensión **Manifest V3** para **Chrome, Edge, Brave, Opera, Vivaldi (build “chrome”) y Firefox ≥140 (build “firefox”)** que, igual que *Video DownloadHelper*:

- **Detecta automáticamente** los vídeos que carga la página actual, incluidos los que el `<video>` reproduce con una URL **`blob:`** (MediaSource/MSE: hls.js, dash.js, Video.js, Shaka…), donde “clic derecho → guardar vídeo” no sirve. La clave: el `blob:` es solo la salida del reproductor; la fuente real es un **manifiesto** (`.m3u8` HLS o `.mpd` DASH) o un fichero progresivo que se pide por red. La extensión observa esas peticiones, **no** el blob.
- **No requiere reproducir el vídeo**: al abrir o **recargar** la página detecta el stream y puede descargarlo ya (el usuario elige calidad y pulsa “Descargar”, o activa un modo **auto-descarga** que baja la mejor calidad al detectar).
- **Reconstruye** el vídeo descargando directamente los segmentos y generando **un único MP4 con vídeo+audio** (el audio puede venir en un stream aparte), con la **misma calidad** que la elegida (rendición/Representation seleccionada), **sin recodificar**.
- El MP4 de salida debe ser un **MP4 clásico “faststart”** (no fragmentado): `ftyp`+`moov` al principio, tablas de muestras completas, duración visible, buscable en cualquier reproductor, con *edit lists* para mantener la sincronía A/V.
- Maneja: HLS TS (H.264/AAC), HLS fMP4/CMAF, audio en rendición separada, cifrado **AES-128**, DASH fMP4 (SegmentTemplate con `$Number$`/`$Time$`/`SegmentTimeline`, SegmentList, SegmentBase), manifiestos **sin extensión o con content-type genérico** (detección por contenido), CDNs protegidos por **Referer/Origin**, ficheros progresivos (`.mp4`, `.webm`…).
- Muestra progreso, permite **cancelar**, nombra el fichero con el título de la pestaña + calidad (`Título [720p].mp4`), y funciona con varias descargas.

Fuera de alcance (documentar como limitación, no fingir): DRM, WebM/VP9 en DASH, HEVC dentro de TS, audio HLS “packed AAC (ADTS)”, streams MSE sin manifiesto accesible, Safari.

## 2. ARQUITECTURA OBLIGATORIA

```
streamgrab/
  package.json              (type: module; scripts: build, fixtures, test, test:e2e, lint:firefox, pack, check)
  scripts/build.mjs         esbuild: genera dist/chrome y dist/firefox (+ zips con --zip); manifests por target
  scripts/make-icons.py     iconos PNG 16/32/48/128
  src/core/                 ← lógica pura SIN APIs de navegador (debe funcionar también en Node 20+)
    xml.js                  parser XML mínimo propio (en service workers NO existe DOMParser)
    util.js                 resolveUrl, fetchBytes (reintentos+backoff+Range+AbortSignal), orderedPool, sanitizeFilename
    hls.js                  parseHls (master/media, KEY, MAP, BYTERANGE, MEDIA-SEQUENCE, ENDLIST, grupos AUDIO)
    dash.js                 parseDash (Period más largo, BaseURL en cascada, Template/Timeline/List/Base, ContentProtection)
    analyze.js              analyzeManifest(url) → {kind, options[{id,label,height,bandwidth}], duration, live, problem}
    download.js             downloadStream(url,{optionId,signal,onProgress,fetch}) → {blob,duration,tracks}
    mp4.js                  buildMp4(sources) fMP4→MP4 clásico + mezcla de varias fuentes; splitFragmented()
  src/background.js         detección (webRequest), análisis, orquestación, reglas DNR, downloads API, estado
  src/engine-host.js        ejecuta descargas (startJob/cancelJob/revoke)
  src/engine.html + engine-page.js   documento offscreen de Chrome que aloja engine-host
  src/inject-main.js        content script en mundo MAIN (document_start, all_frames): sniffing de manifiestos en fetch/XHR
  src/content.js            content script aislado: reenvía mensajes de inject-main al background
  src/popup.html/.css/.js   UI (sin innerHTML: construir DOM con createElement; AMO lo penaliza)
  tests/make-fixtures.sh    genera streams reales con ffmpeg
  tests/helpers/            servidor HTTP con Range + ruta /protected/ que exige Referer; wrappers de ffprobe/ffmpeg
  tests/unit/engine.test.mjs   tests del núcleo (node:test) contra los fixtures
  tests/e2e/run.mjs         e2e con Chromium real + puppeteer-core
  .github/workflows/ci.yml, release.yml
  README.md (EN + sección ES), LICENSE (MIT), CONTRIBUTING.md, .gitignore, docs/
```

Dependencias: `mux.js@7` (runtime: transmux TS→fMP4), y dev: `esbuild`, `puppeteer-core`, `web-ext`, `hls.js` (solo para la página de test).

**Dónde corre cada cosa (decisión importante):**
- Descargas largas NO en el service worker de Chrome (se suspende a los ~30 s sin eventos). En Chrome: **documento offscreen** (`chrome.offscreen.createDocument`, reason `BLOBS`) que importa `engine-host`; el SW le manda `{target:'engine',type:'start'|'cancel'|'revoke'}` y recibe `{target:'bg',type:'progress'|'done'|'error'|'cancelled'}`. En Firefox (event page con DOM): `await import('./engine-host.js')` directamente en el background.
- El final de la descarga genera un `Blob` → `URL.createObjectURL` en el engine → el background llama a `downloads.download({url: blobUrl, filename})` y revoca la URL al completarse (`downloads.onChanged`).
- El código específico de Firefox se elimina del bundle de Chrome con `define: {__FIREFOX__: 'false'}` y usando **`if (__FIREFOX__) {...}` directamente** (si lo metes en una `const` intermedia esbuild no lo poda y el bundle de Chrome arrastra mux.js: comprueba que `dist/chrome/background.js` pesa ~25 KB y no contiene “Transmuxer”).
- Bundles `format: 'iife'` (el background de Firefox es event page clásico; evita problemas de módulos). `target: ['chrome116','firefox128']`.

**Estado:** el SW de Chrome muere; guarda detecciones/jobs en `chrome.storage.session` (con debounce) y recárgalos al arrancar (`const ready = ...; await ready` en cada handler). Ajustes en `storage.local`.

## 3. MANIFESTS (generados por build.mjs)

Común: `manifest_version:3`, `permissions: ['webRequest','downloads','storage','tabs','declarativeNetRequest']`, `host_permissions:['<all_urls>']`, `action` con popup, iconos, y dos content_scripts en `<all_urls>`, `document_start`, `all_frames`, `match_about_blank`:
  - `inject-main.js` con `"world":"MAIN"`; `content.js` (mundo aislado).
Chrome: añade `permissions:'offscreen'`, `background:{service_worker:'background.js'}`, `minimum_chrome_version:'116'`.
Firefox: `background:{scripts:['background.js']}`, `browser_specific_settings.gecko:{id, strict_min_version:'140.0', data_collection_permissions:{required:['none']}}` y `gecko_android:{strict_min_version:'142.0'}`. **`npx web-ext lint --source-dir dist/firefox` debe dar 0 errores y 0 avisos.**

⚠️ Usa el permiso **`declarativeNetRequest`** (no `...WithHostAccess`): con WithHostAccess se exige permiso sobre el *initiator* y las peticiones iniciadas por la propia extensión (`chrome-extension://…`) no lo cumplen → las reglas de cabeceras no se aplican.

## 4. DETECCIÓN (background.js)

1. `webRequest.onHeadersReceived` (`['responseHeaders']`, tipos `xmlhttprequest, media, other, object, main_frame, sub_frame`, URLs `<all_urls>`). Ignora `tabId<0`.
2. Clasificar:
   - HLS: ruta termina en `.m3u8` o content-type contiene `mpegurl`.
   - DASH: ruta termina en `.mpd` o `application/dash+xml`.
   - Descartar segmentos y ruido: `.ts .m4s .m4f .cmfv .cmfa .aac .vtt .key`, imágenes, js/css/json/html y `video/mp2t`, `video/iso.segment`.
   - Fichero progresivo: content-type `video/*`/`audio/*` o extensión de vídeo/audio, **tamaño ≥ 300 KB** (usa el total de `Content-Range` si es 206) y status <400.
3. **Sniffing por contenido** (`inject-main.js`, mundo MAIN): envolver `window.fetch` y `XMLHttpRequest.prototype.open`; en respuestas con content-type no binario y <5 MB leer solo los primeros ~600 bytes (en fetch: `res.clone().body.getReader().read()` y `cancel()`); si empiezan por `#EXTM3U` o contienen `<MPD` → `window.postMessage({source:'streamgrab',type:'manifest',url})`. Envolver `URL.createObjectURL` para avisar `{type:'blob'}` cuando el argumento es un `MediaSource` (para mostrar en el popup “esta página usa blob; recárgala”). `content.js` lo reenvía con `runtime.sendMessage`. **El background no confía en lo que dice la página**: trata esas URLs como candidatas (`kind:'sniffed'`) y es `analyzeManifest` quien decide si son manifiestos reales (si falla, descartar silenciosamente).
4. Por pestaña: lista de items `{id,url,kind,size,ct,pageUrl,title,state:'analyzing'|'ready',options,problem,duration,live,hidden}`; sin duplicados por URL; se vacía en navegación completa (`tabs.onUpdated` con `status==='loading'` y `info.url`) y al cerrar la pestaña (⚠️ cerrar la pestaña borra sus detecciones: tus tests no deben cerrarla antes de descargar).
5. Tras detectar un manifiesto, **analizarlo** (`analyzeManifest`): para master HLS listar variantes ordenadas por altura/bitrate (etiqueta `720p · 2.8 Mbps`) y **ocultar** (`hidden`) las playlists hijas que pertenecen a un master ya detectado (el reproductor las pide inmediatamente después; marca hijas retroactivamente cuando llega el master y viceversa).
6. Badge de la acción con el número de items visibles sin problema.
7. **Auto-descarga** (ajuste, desactivado por defecto): al quedar `ready` un item HLS/DASH sin `problem`/`live`/`hidden`, esperar ~2,5 s (para que se oculten hijas) y descargar la opción `'0'` (mejor). No auto-descargar ficheros progresivos (suelen ser anuncios/previews).
8. **Historial de descargas** (añadido en 1.1.0): al confirmar el navegador un fichero (`downloads.onChanged` estado `complete`) se registra en `storage.local` (`history`, máx. 200 entradas) una entrada `{id, fin, title, filename, quality, kind, size, srcUrl, pageUrl, options, optionId, dlId}`. Mensajes: `getHistory` (items + stats + jobs activos ligados por `histId`), `histDownload` (revalida el manifiesto con `analyzeManifest`; la calidad pedida por el popup tiene prioridad sobre la grabada), `histRemove`, `histClear`, `openFile` (con fallback a `downloads.show` para build Chrome, que no debe declarar el permiso `downloads.open`: en Chromium MV3 el manifest muere), `showFile`. Los jobs que salen del historial llevan `histId` para que el popup les muestre progreso.
8. `pageUrl`: usa `details.documentUrl || originUrl || initiator`. ⚠️ `initiator` es **solo el origen sin `/` final**; si falta ruta usa la URL de la pestaña (o añade `/`) — hay servidores que validan `Referer` con prefijo `https://host/`.

## 5. EMULAR Referer/Origin (CDNs con hotlink protection)

Las peticiones del motor salen desde la extensión (Origin/Referer `chrome-extension://…`). Antes de analizar/descargar añade una **regla de sesión DNR**:
`{id, priority:id, action:{type:'modifyHeaders', requestHeaders:[{header:'referer',operation:'set',value:pageUrl},{header:'origin',operation:'set',value:origin(pageUrl)}]}, condition:{tabIds:[-1], resourceTypes:['xmlhttprequest','other','media']}}`
(`tabIds:[-1]` = peticiones que no vienen de una pestaña, o sea las de la extensión; así no tocas el tráfico de la página). Elimina la regla al terminar/cancelar/fallar el job. Las `fetch` usan `credentials:'include'` para que viajen las cookies. Verifica con un test que una ruta `/protected/*` que responde 403 sin Referer correcto **sí** se descarga.

## 6. MOTOR (src/core) — ESPECIFICACIÓN TÉCNICA

### 6.1 util
- `fetchBytes(url,{range,signal,retries=3,fetch})`: backoff exponencial, `Range: bytes=a-b`; si el servidor ignora Range (200) recorta localmente; `AbortError` propio.
- `orderedPool(tasks, concurrency=6, signal)`: async generator que descarga en paralelo pero **entrega en orden** y limita el buffer a `concurrency*2` resultados (memoria acotada). Propaga el primer error.

### 6.2 HLS
Master: `#EXT-X-STREAM-INF` (BANDWIDTH/AVERAGE-BANDWIDTH, RESOLUTION, CODECS, AUDIO, FRAME-RATE) + `#EXT-X-MEDIA:TYPE=AUDIO` con URI. Media: `#EXTINF`, `#EXT-X-BYTERANGE` (len@off; sin off continúa tras el rango anterior), `#EXT-X-KEY` (METHOD=AES-128|NONE|otros, URI, IV hex, KEYFORMAT), `#EXT-X-MAP` (init, con BYTERANGE opcional), `#EXT-X-MEDIA-SEQUENCE`, `#EXT-X-ENDLIST`, discontinuidades. Resolver URLs relativas contra la URL de la playlist.
- Cifrado: solo `AES-128` con `KEYFORMAT=identity`. IV = el declarado o, si falta, el **número de secuencia** como entero big-endian de 16 bytes. Descifrar con WebCrypto `AES-CBC` (el padding PKCS7 lo gestiona la API). `SAMPLE-AES` o KEYFORMAT no identity ⇒ error “DRM”.
- Contenedor de segmento por **sniffing de bytes**: `0x47` en offset 0 y 188 ⇒ TS; box `ftyp/styp/moof/sidx/moov` en offset 4 ⇒ fMP4; `ID3`/`0xFFFx` ⇒ AAC empaquetado (no soportado: error claro).
- TS: **mux.js** `new muxjs.mp4.Transmuxer({keepOriginalTimestamps:true})`; `push(bytes); flush()` por segmento en orden; en el evento `data` guardar la primera `initSegment` y todos los `data`. `keepOriginalTimestamps:true` es importante para que audio y vídeo (incluso de playlists distintas) conserven su relación temporal real.
- fMP4: init = `EXT-X-MAP` (o, si no hay, `splitFragmented` del primer segmento); chunks = segmentos.
- Con `variant.audioGroup` y rendición de audio con URI ⇒ descargar también esa playlist como segunda fuente (elige `DEFAULT=YES` primero).

### 6.3 DASH
Parser XML propio. Usa el **Period de mayor duración**. `BaseURL` en cascada MPD→Period→AdaptationSet→Representation. Hereda atributos AdaptationSet→Representation. Para `SegmentTemplate`: sustituir `$RepresentationID$ $Number$ $Bandwidth$ $Time$` (con formato `%05d`) y `$$`; con `SegmentTimeline` expandir `S@t,d,r` (r=-1 ⇒ hasta fin de Period); sin timeline: `ceil(duración·timescale/duration)` segmentos desde `startNumber`. `SegmentList` (Initialization+SegmentURL con mediaRange). `SegmentBase`/solo `BaseURL`: descargar el fichero completo (fMP4 con sidx) y `splitFragmented`. `ContentProtection` en cualquier nivel ⇒ `encrypted` ⇒ error DRM. Elegir vídeo = opción del usuario; audio = el de mayor bitrate. Rechazar WebM/VP9/Opus con mensaje claro.

### 6.4 `mp4.js` — fMP4 → MP4 clásico (la pieza crítica; sin dependencias)
Entrada: `sources=[{init, chunks[], absStart?}]`; cada fuente puede traer varias pistas. Salida: partes de Blob `[ftyp, moov, mdat-header, ...slices]` (sin concatenar: usa `subarray` y **fusiona muestras contiguas** en un solo slice).
1. **Init**: recorrer cajas; por `trak` extraer `tkhd` (track_ID, width/height 16.16; offsets distintos en versión 0/1), `mdhd` (timescale, lang), `hdlr` (solo `vide`/`soun`), `stsd` (copiar caja cruda), `dinf`, `vmhd/smhd`, y `mvex/trex` (defaults).
2. **Fragmentos**: por cada `moof/traf`: `tfhd` (flags 0x1 base_data_offset, 0x2 desc idx, 0x8 dur, 0x10 size, 0x20 flags, 0x20000 default-base-is-moof), `tfdt` (v0/v1, baseMediaDecodeTime), `trun` (flags 0x1 data_offset i32 relativo a moof, 0x4 first_sample_flags, 0x100 dur, 0x200 size, 0x400 flags, 0x800 cto; en versión 1 el cto es con signo). Registrar cada muestra `{chunk, offset, size, dur, flags, cto}` **sin copiar bytes**. Ignorar cajas desconocidas (`styp`, `sidx`, `prft`…).
3. **Renumerar pistas** 1..N al mezclar fuentes (audio y vídeo suelen ser ambos `track_ID=1`).
4. **Sincronía**: `ptsStart = (firstDts + firstCto)/timescale` por pista; `origin = min(ptsStart)`; `delay = ptsStart - origin`. `elst`: si `delay>0` una edición vacía (`media_time=-1`, duración en timescale de película=1000) y luego la edición principal con `media_time = firstCto` y duración `(presEnd - firstCto)` donde `presEnd = max(dts_i + cto_i + dur_i)` (⚠️ NO uses `sum(dur) - firstCto`: pierdes los últimos fotogramas con B-frames; lo descubrimos porque salían 298 de 300 fotogramas).
5. **Tablas**: `stts` (RLE de duraciones), `ctts` (solo si hay cto≠0; versión 1 si hay negativos), `stss` (solo vídeo y solo si no todas son sync; sync = flag bit 16 `sample_is_non_sync_sample` a 0), `stsz`, `stsc` + `stco` con **chunks de ≈1 s** y orden **entrelazado por tiempo** entre pistas, `mdhd/tkhd/mvhd` (movie timescale 1000), `edts/elst`.
6. **Layout faststart**: `ftyp(isom, compat isom iso2 avc1 mp41)` + `moov` + `mdat`. Los offsets de `stco` dependen del tamaño de `moov`: construir `moov` dos veces (primero con offsets 0 para medir, luego con el offset real). Si el total >4 GB ⇒ usar `co64` (offsets de 64 bits) y cabecera `mdat` extendida (size=1 + u64); el modo se puede forzar con `buildMp4(src,{force64:true})` para testearlo con un fichero pequeño.
7. `splitFragmented(bytes)`: localizar `moov` y verificar que hay `moof`; devolver `{init, media, mediaOffset}` (error claro si el MP4 no está fragmentado).

### 6.5 download.js
`downloadStream(url,{optionId,kind,signal,onProgress,fetch,concurrency})`: detecta HLS/DASH por contenido, descarga fuentes (vídeo, luego audio), emite `{phase:'download',done,total,bytes}` y `{phase:'mux'}`, llama a `buildMp4`, devuelve `{blob,duration,tracks,size}`. Cancelación vía `AbortSignal` en todas las fases. Errores con mensajes legibles (HTTP 4xx/5xx, DRM, formato no soportado).

## 7. POPUP

Lista de tarjetas para la pestaña activa: insignia `HLS|DASH|MP4`, título de la pestaña, host+ruta, duración/tamaño, `<select>` de calidades (si hay >1), botón **Descargar**, **Cancelar** durante la descarga, barra de progreso y estado (Descargando n % · MB / Generando MP4… / Guardando… / Guardado ✓ / Error). Mensajes específicos para `problem` (`drm`, `webm`, `empty`) y `live`. Estado vacío con instrucción “recarga la página (F5)”, y mensaje distinto si la página usa blob. Interruptor “Auto-descarga” y botón “Limpiar”. Sondeo cada 600 ms; reconstruye el DOM solo si cambia la firma estructural y actualiza barras de progreso in situ (para no cerrar un `<select>` abierto). Soporta `popup.html?tab=ID` para tests/capturas. Modo claro/oscuro con `prefers-color-scheme`. **Sin `innerHTML`.**

Pestañas **Vídeos | Historial** en la cabecera (con contador). Vista Historial: buscador por título/sitio/fichero, tarjetas con insignia de tipo + chip `MP4`, etiqueta de calidad, tamaño, fecha relativa (i18n es/en), acciones con iconos SVG (re-descargar con selector de calidad, abrir vídeo, mostrar en carpeta, copiar URL del stream con confirmación visual, quitar del historial), “Vaciar” con confirmación en dos clics sin diálogos bloqueantes, barra de progreso para las re-descargas en curso y línea de estadísticas (nº descargas · tamaño total) en el pie.

## 8. TESTS (obligatorios y reales)

### 8.1 Fixtures (`tests/make-fixtures.sh`, requiere ffmpeg con libx264+aac)
Fuente sintética: `testsrc2` 640x360@25 fps, 12 s + `sine` 44,1 kHz; GOP 50, `-bf 2` (B-frames, para forzar cto≠0). Genera: (a) `progressive/ref.mp4`; (b) `hls_ts/` con dos rendiciones (360p y 180p) + `master.m3u8`; (c) `hls_enc/` HLS TS cifrado AES-128 (`-hls_key_info_file`, clave aleatoria con openssl); (d) `hls_fmp4/` vídeo y audio en **playlists separadas** con `master.m3u8` que usa `EXT-X-MEDIA TYPE=AUDIO`; (e) `dash/` (`-f dash -use_template 1 -use_timeline 1`, init y chunks separados por Representation).

### 8.2 Tests de motor (`node --test`, contra un servidor HTTP local con soporte Range)
Para cada caso: ejecutar `downloadStream`, escribir el MP4 y comprobar con **ffprobe**: códecs `h264`+`aac`, resolución esperada, `|duración-12|<0.3`, **`nb_read_frames == 300`**, que `ffmpeg -v error -i out.mp4 -f null -` **no emite ningún error**, que `moov` aparece antes que `mdat` (faststart) y que `|start_time_v - start_time_a| ≤ 0.1`. Casos: HLS-TS master mejor calidad; peor calidad; HLS AES-128; HLS fMP4 + audio separado; DASH audio/vídeo separados; segmento 404 ⇒ error claro `HTTP 404` sin colgarse; cancelación con `AbortSignal`; `analyzeManifest` lista calidades ordenadas.
Además, una comprobación de **fidelidad**: el fotograma en t=6 s del MP4 resultante debe tener PSNR=∞ (idéntico bit a bit) frente al que produce el propio ffmpeg remuxando el mismo stream (`ffmpeg -i master.m3u8 -c copy`).

### 8.3 E2E en navegador real (`tests/e2e/run.mjs`, puppeteer-core)
- ⚠️ **Chrome de marca ≥137 eliminó `--load-extension`.** Usa un Chromium que lo soporte: p. ej. *ungoogled-chromium portable* desde GitHub Releases (`ungoogled-software/ungoogled-chromium-portablelinux`, asset `…-x86_64_linux.tar.xz`; la URL `…/releases/latest` redirige al tag) o Chrome for Testing si hay red. `headless:'new'`, args `--no-sandbox --disable-extensions-except=dist/chrome --load-extension=dist/chrome`. Ese Chromium no trae códecs propietarios: no importa, la detección no depende de reproducir.
- Servidor de test que sirve: `index.html` con **hls.js** (vídeo MSE `blob:` real), `hidden.html` (manifiestos servidos en `/api/getstream?id=42` con `Content-Type: text/plain`, pedidos con `fetch` y con XHR, y un `MediaSource`), `dash.html`, y `/protected/*` (403 si el `Referer` no empieza por `http://<host>/`).
- Conducir la extensión desde una página `chrome-extension://<id>/popup.html` (el id sale de la URL del target `service_worker`) usando `chrome.runtime.sendMessage({type:'getState',tabId})`, `{type:'download',…}`.
- Descargas: `Browser.setDownloadBehavior({behavior:'allow',downloadPath})` por CDP (⚠️ ese modo renombra el fichero a un GUID; para comprobar el nombre usa `job.filename` del estado).
- Checks mínimos: extensión cargada; HLS detectado en página con blob; **solo se lista el master** (hijas ocultas); calidades en orden; badge “1”; descarga completa sin reproducir (pausa el vídeo) → MP4 válido (ffprobe: h264+aac 640x360, 300 fotogramas, sin errores de decodificación); nombre `Título [360p].mp4`; HLS protegido por Referer descargado; manifiestos disfrazados detectados por sniffing; la página queda marcada como blob; DASH detectado y descargado (vídeo+audio, 300 fotogramas); **auto-descarga**: activar ajuste, recargar y comprobar que aparece un MP4 nuevo sin hacer clic; el popup renderiza (guarda captura PNG y revísala).
- Todo en `npm run test:e2e`; exit code ≠ 0 si algo falla. Escribe `tests/e2e/last-run.txt`.

### 8.4 Otros
`npm run build` sin warnings; `web-ext lint` 0/0/0; `node --check` en todos los fuentes; el bundle de Chrome no contiene mux.js en `background.js`.

## 9. FASES Y PUERTAS DE VERIFICACIÓN

1. **Entorno**: comprueba `node -v` (≥20), `ffmpeg -encoders | grep -E "libx264|aac"`, descarga un Chromium compatible y ejecuta `chrome --version`. Puerta: todo disponible; si no, di exactamente qué falta.
2. **Scaffold + fixtures**: package.json, build, `make-fixtures.sh`. Puerta: `ffprobe` valida los fixtures.
3. **Núcleo** (xml, util, hls, dash, analyze) + tests de parsers. Puerta: tests de `analyzeManifest` en verde.
4. **mp4.js + download.js** (empieza por fMP4→MP4 con un fMP4 simple, luego mezcla A/V, luego TS con mux.js, luego AES). Puerta: todos los tests de 8.2 en verde, incluida la fidelidad.
5. **Extensión** (manifests, background, engine, content scripts, popup). Puerta: build de ambos targets + `web-ext lint` 0/0/0.
6. **E2E** (8.3). Puerta: todos los checks PASS. Revisa la captura del popup.
7. **GitHub-ready**: README (EN + ES), LICENSE MIT, CONTRIBUTING, `.gitignore` (node_modules, dist, tests/fixtures, zips), CI (`ci.yml`: ffmpeg, `npm ci`, fixtures, build, test, lint, descarga de Chromium, e2e, pack, upload-artifact), `release.yml` (tag `v*` ⇒ zips al Release), `npm run check`. `git init`, commits, `npm run pack` genera `streamgrab-chrome-vX.zip` y `streamgrab-firefox-vX.zip`.
8. **Informe final**: qué se probó (con salidas reales), qué NO se pudo probar, limitaciones conocidas, instrucciones de instalación en cada navegador, y pasos para publicar en Chrome Web Store / AMO (el ZIP de Firefox necesita además el código fuente para revisión).

## 10. TRAMPAS CONOCIDAS (ya nos picaron; evítalas)

- `chrome.runtime.onMessage` con respuesta asíncrona: devuelve `true` y usa `sendResponse` (funciona en Chrome y Firefox).
- `downloads.download({filename})` puede lanzar **“Invalid filename”** si el nombre tiene caracteres no ASCII y el locale del sistema no es UTF-8 (típico en contenedores/CI). Envuelve en `saveFile()` que reintenta con un nombre ASCII (NFKD + reemplazo). Sanea siempre `\ / : * ? " < > |` y caracteres de control; limita a ~120 caracteres.
- DOMParser no existe en service workers ⇒ parser XML propio.
- `mux.js` por sí solo no mezcla pistas de playlists distintas ⇒ de ahí `mp4.js` con renumeración y entrelazado.
- Las dos primeras versiones del `elst` perdían 2 fotogramas finales (ver 6.4.4).
- `declarativeNetRequestWithHostAccess` no aplica a peticiones de la propia extensión (ver sección 3).
- `initiator` sin `/` final rompe servidores que validan `Referer` (ver 4.8).
- Cerrar la pestaña borra sus detecciones (`tabs.onRemoved`).
- En el SW de Chrome no hay `URL.createObjectURL` útil para descargas largas: por eso el offscreen.
- El Chromium de test sin H.264 NO impide la detección; no uses reproducción real como criterio.
- Firefox: usa `browser.*` si existe; `storage.session` disponible desde 115; `world:'MAIN'` en content_scripts desde 128; clave `data_collection_permissions` desde 140.
- No uses `localStorage` en el SW; no uses `eval`/`new Function` (CSP MV3).
- Mantén `README` honesto: lista limitaciones y qué se verificó realmente.

- **Escala (bug real: “Maximum call stack size exceeded” en vídeos de 1 h):** NUNCA pases arrays grandes con spread (`f(...arr)`) a cajas MP4; escribe las tablas (`stts/ctts/stsz/stss/stsc/stco`) con `Uint8Array`+`DataView`. Guarda los segmentos como `Blob` (respaldados en disco por el navegador) y lee solo las cabeceras `moof` para parsear muestras; el `mdat` final se compone con `blob.slice`. Añade un fixture de 1 hora (`testsrc2` 160x90@30, 108k fotogramas) y un test de regresión que compruebe 108000 fotogramas, 3600 s y 0 errores de decodificación, también en el e2e.
- **Límite de tamaño opcional:** ajuste `maxGB` (0 = sin límite, por defecto) en el popup; se comprueba acumulando bytes y falla con `SIZE_LIMIT:<bytes>` (mensaje localizado). No impongas límites ocultos.

## 11. CRITERIOS DE ACEPTACIÓN FINALES (checklist)

- [ ] `npm run check` termina con exit code 0 (build + tests de motor + lint Firefox + e2e).
- [ ] MP4 de salida: h264+aac, 300/300 fotogramas, sin errores de ffmpeg, faststart, A/V ≤100 ms, duración correcta, PSNR=∞ frente al remux de ffmpeg.
- [ ] Detección en página con `<video src="blob:…">` real (hls.js) sin reproducirlo.
- [ ] Referer-protected, AES-128, audio separado, DASH, manifiestos disfrazados: todos descargados.
- [ ] Auto-descarga funcionando tras recargar la página.
- [ ] `dist/chrome` y `dist/firefox` generados; `web-ext lint` 0/0/0; zips creados.
- [ ] Repo listo para GitHub (CI + release + README + LICENSE) con historial git limpio.
- [ ] Informe final con evidencias y limitaciones reales (sin afirmar nada no ejecutado).
