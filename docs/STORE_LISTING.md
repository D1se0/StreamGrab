# Store listing (Chrome Web Store / Firefox AMO)

**Name:** StreamGrab – HLS/DASH/Blob Video Downloader
**Short description (≤132):** Detects HLS, DASH and blob videos and saves them as one MP4 with audio – no need to play them. Private, open source.

**Long description:**
StreamGrab finds the video streams a page loads – including players that only expose a `blob:` URL – and rebuilds them into a single MP4 (video + audio) at the quality you choose. Open or reload the page, pick the item, download. Features: quality picker, audio-only (M4A), queue, live speed/ETA, searchable history, notifications, file-name templates, auto-download, light/dark theme, English/Español. Open source, no analytics, no servers. Does not download DRM-protected content.

**Permission justifications:** webRequest/<all_urls> – detect media manifests and fetch segments; downloads – save the result; declarativeNetRequest – send the page's Referer/Origin to CDNs that require it; storage – settings/history; tabs – tab title for file names; notifications – completion alerts; offscreen – assemble the file off the service worker.
**Category:** Productivity. **Single purpose:** download videos the user is viewing.
**Firefox note:** upload the source ZIP (`git archive`) with build instructions: `npm ci && npm run build`.
