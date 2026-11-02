# Contributing

1. `npm ci`
2. `npm run fixtures` (needs `ffmpeg` with libx264/aac) – generates HLS/DASH test streams.
3. `npm run build` → `dist/chrome`, `dist/firefox`.
4. `npm test` (engine, real ffmpeg/ffprobe verification) and `npm run test:e2e` (real Chromium; set `CHROME_BIN` to a Chromium that supports `--load-extension`, e.g. ungoogled-chromium or Chrome for Testing – branded Chrome ≥137 removed that flag).
5. `npm run lint:firefox` must report 0 errors / 0 warnings.

Rules: no feature without a test that decodes the produced MP4 with ffmpeg; never add DRM circumvention.
