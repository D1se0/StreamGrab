# Privacy policy
StreamGrab runs entirely in your browser.
- **No data collection.** No analytics, telemetry, accounts or remote servers of ours.
- **Network:** the extension only requests the video manifests/segments of the page you are on (the same hosts the page itself uses), sending your normal cookies and an emulated `Referer/Origin` so the host accepts the request. It also loads the page's own poster/`og:image` to show a thumbnail in the popup.
- **Local storage:** settings and (optionally) your download history are stored with `storage.local` on your device; detections live in `storage.session` and vanish when the browser closes. You can delete the history in the popup or turn it off.
- **Permissions:** `webRequest` (observe media requests), `<all_urls>` (read/download those streams), `downloads` (save files), `declarativeNetRequest` (Referer/Origin), `storage`, `tabs` (tab title/URL), `notifications`, `offscreen` (Chrome only: assemble the MP4).
