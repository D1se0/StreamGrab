# StreamGrab – HLS / DASH / `blob:` video downloader (Chrome, Edge, Brave, Opera, Vivaldi, Firefox)

Detects the video streams a page loads – including players that expose only a `blob:` URL (MSE / hls.js / dash.js / Video.js…) –
and rebuilds them into **one seekable MP4 with video + audio**, at the quality you choose. It reads the stream manifest and
downloads the segments directly, so **you don't have to play the video**: open the page (or reload it), pick the item, download.

*Español: ver sección [Uso](#uso-es) más abajo.*

## What it does

| Source | Support |
|---|---|
| HLS `.m3u8` (MPEG-TS H.264/AAC) | ✅ transmuxed to MP4 (mux.js) |
| HLS fMP4/CMAF, separate audio renditions | ✅ merged |
| HLS AES-128 encrypted segments | ✅ decrypted with WebCrypto |
| DASH `.mpd` (SegmentTemplate/Timeline/List/Base, fMP4 H.264/AAC) | ✅ video + audio merged |
| Manifests with no extension / generic content-type (sniffed from the page's fetch/XHR) | ✅ |
| Progressive `.mp4/.webm` | ✅ handed to the browser's downloader |
| Referer/Origin-protected CDNs | ✅ emulated with `declarativeNetRequest` |
| Quality picker, progress, cancel, auto-download mode, **download history with re-download** | ✅ |
| **DRM (Widevine/PlayReady/FairPlay, SAMPLE-AES)** | ❌ never – the extension tells you |
| Live streams | ⚠️ downloads what is currently listed |
| WebM/VP9 DASH, HEVC-in-TS, packed-AAC HLS audio | ❌ not yet |
| Any duration/size (tested: 1 h = 108k frames; >4 GB uses 64-bit MP4 offsets) | ✅ no limit by default; optional size cap in the popup |

The output is a regular "faststart" MP4 (`moov` first, full sample tables, edit lists for A/V sync) – not a fragmented file –
so it seeks and shows its duration in every player.

## Install (development)

```bash
npm ci && npm run build
```
* **Chrome/Edge/Brave/Opera/Vivaldi:** `chrome://extensions` → Developer mode → *Load unpacked* → `dist/chrome`.
* **Firefox (≥140):** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `dist/firefox/manifest.json`.
* Release zips: `npm run pack` → `dist/streamgrab-*.zip`.

## Uso (ES)
1. Abre la página con el vídeo (o **recárgala con F5** si ya estaba abierta: la extensión solo ve las peticiones mientras está activa).
2. El icono muestra un contador. Abre el popup, elige calidad y pulsa **Descargar** (no hace falta reproducir el vídeo).
3. Activa **Descarga automática** si quieres que, al detectar un stream, empiece a descargar la mejor calidad sin hacer clic.
4. ### Historial (nuevo)
   · Pestaña **Historial** con todas las descargas completadas (título, sitio, calidad, tamaño, fecha), con buscador por título/sitio/fichero.
   · **Volver a descargar** cualquier vídeo — antes revalida el manifiesto (puede haber cambiado o haberse caído) — o cambia la calidad con el selector.
   · **Abrir el vídeo** o **mostrarlo en la carpeta de descargas** del navegador de un clic; **copiar la URL del stream** también desde la lista de detecciones.
   · Borrado individual o vaciado completo (con confirmación en dos clics); límite de 200 entradas; se guarda en `storage.local`, no sale del navegador.
   · Línea de estado con el número de descargas y tamaño total acumulado.

## Tests (all run against real tools)
```bash
npm run fixtures   # ffmpeg generates HLS-TS, AES-128 HLS, HLS-fMP4+audio, DASH
npm test           # engine: output verified with ffprobe + full ffmpeg decode + frame count + A/V sync
npm run test:e2e   # real Chromium + built extension + hls.js/MSE page + Referer-protected CDN + auto-download
npm run lint:firefox
```

## Website & releases
```
website/                     React + Vite landing page (https://d1se0.github.io/StreamGrab/)
                             npm test (vitest) + npm run build; deployed by .github/workflows/pages.yml
.github/workflows/ci.yml      full pipeline on every push (fixtures · tests · e2e in ungoogled-chromium · zips)
.github/workflows/release.yml on tag push v*: build + unit tests + zips + GitHub Release with notes from docs/releases/vX.md
docs/releases/               curated release notes per version (template.md as fallback)
```

## Architecture
```
src/core/   xml.js · hls.js · dash.js · analyze.js · download.js · mp4.js (fMP4→MP4 muxer) · util.js   (no browser APIs: runs in Node too)
src/background.js   webRequest detection, manifest analysis, job orchestration, DNR header rules, downloads API
src/engine-host.js  runs a download (Chrome: offscreen document `engine.html`; Firefox: the background page itself)
src/inject-main.js  MAIN-world hook: sniffs manifests in fetch/XHR bodies, flags MediaSource usage (never trusted blindly)
src/popup.*         UI
```
See `docs/AGENT_PROMPT.md` for a full re-implementation spec.

## Limitations / honest notes
* Size: there is **no built-in limit** (you can set an optional cap in the popup footer). Segments are kept as browser Blobs (disk-backed), but the practical ceiling is your free disk space / browser Blob quota; multi-GB files were not exercised end to end here, only the 64-bit MP4 layout (`co64`) was validated.
* Sites that stream through MSE **without any fetchable manifest** (custom binary protocols) cannot be reconstructed from requests.
* Only use it on content you have the right to download. DRM is not bypassed and never will be.
* Firefox build is lint-clean (`web-ext lint`: 0 errors/warnings) but the automated browser e2e currently runs on Chromium only.

MIT licensed.
