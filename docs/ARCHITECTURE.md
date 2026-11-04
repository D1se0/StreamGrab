# Architecture

```
 page (hls.js / dash.js / blob:)                      ┌──────────────────────────────┐
   │ fetch/XHR manifest + segments                     │ popup (Detected/History/Settings)
   ▼                                                   └──────────────▲───────────────┘
 webRequest.onHeadersReceived ─► background (SW / event page) ◄──────┘ runtime messages
 inject-main.js (MAIN world) ─► content.js ─►  │  • classify, analyse manifests (core/analyze)
   sniff manifests in fetch/XHR bodies         │  • per-tab items, badge, queue, history, notifications
                                               │  • DNR session rule: Referer/Origin for extension requests
                                               ▼
                           engine (Chrome: offscreen doc · Firefox: background page)
                                core/download.js
        HLS/DASH parse ─► fetch segments (ordered pool) ─► AES-128 ─► TS→fMP4 (mux.js) ─► core/mp4.js ─► Blob
                                               │
                                               ▼  URL.createObjectURL → downloads.download → history/notification
```

## Key decisions
- **Core is browser-agnostic** (`src/core`): runs in Node, so every format path is tested against real ffmpeg output.
- **Own MP4 muxer** (`mp4.js`): fMP4 → classic faststart MP4, merges separate audio/video, edit lists for sync, `co64` for >4 GB, Blob-backed chunks, typed-array tables (no spread → no stack overflows).
- **Downloads outside the Chrome service worker** (it is suspended after ~30 s): offscreen document.
- **Page is untrusted**: sniffed URLs are only candidates; `analyzeManifest` decides.
- **Referer/Origin**: session DNR rule scoped to `tabIds:[-1]` (extension-initiated requests), removed after the job.
- **State**: detections/jobs in `storage.session`; settings/history in `storage.local`.

## Message protocol (popup/engine ↔ background)
`getState` `download{tabId,itemId,optionId,mode,thumb}` `downloadAll` `cancel` `clear` `setSettings` `getHistory` `historyDelete` `historyClear` `historyShow` `openUrl`
Engine → bg: `{target:'bg', type:'progress|done|error|cancelled', jobId, …}`; bg → engine: `{target:'engine', type:'start|cancel|revoke'}`.
