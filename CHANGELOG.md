# Changelog
Format: [Keep a Changelog](https://keepachangelog.com/) · Versioning: [SemVer](https://semver.org/)

## [1.2.0]
### Changed – design overhaul
- New design system: tokens for light/dark, indigo→violet accent, AA-contrast palette, Inter/Segoe-style type, tabular numbers, soft shadows, subtle motion (respects `prefers-reduced-motion`).
- Header with logo, current-site pill and a live "downloads in progress" indicator; segmented-control tabs with counters.
- Cards: thumbnail with format/duration chips, 2-line titles, size/quality chips, Video/Audio switch, custom quality dropdown (★ best), full-width primary button.
- Dedicated progress block (status, %, bytes, speed, ETA, cancel), queued/muxing animations, success strip with "Show", error strip with "Retry", DRM/live notices, skeleton while analysing.
- Guided empty state (3 steps) + blob warning; toasts instead of tooltips for "Copied!".
- History: thumbnails/typed tiles with status badge, sticky day headers, totals summary, hover actions, ellipsised metadata.
- Settings: grouped sections with icons, segmented controls (parallel downloads, theme, language), template chips + live preview, about card.
### Tests
- **Design gallery** (`npm run test:gallery`): renders the real popup with simulated states (long/unbroken titles, 403 errors, queue, DRM, live, 40-entry history, empty/blob states) in light/dark × EN/ES and audits overflow, clipped text, spill-out, tap targets and WCAG AA contrast. The audit itself is self-tested with deliberately broken CSS.
- Fixed by the audit: low-contrast amber notices, dimmed history rows, template chips below tap-target size, a button overhanging its card, error text overlapping the Retry button.

## [1.1.1]
### Fixed
- Popup tabs overlapped (History/Settings drew on top of Detected): a `display:flex` rule defeated the `hidden` attribute. Added a global `[hidden]{display:none!important}` guard.
- History rows no longer wrap the time onto a second line.
### Tests
- New regression `npm run test:ui` (and e2e step): real clicks through every tab order, asserting exactly one visible section, no overlap and no content leaking between sections; verified it FAILS on the buggy CSS and passes with the fix. Also empty-state isolation checks. E2E now 45 checks.

## [1.1.0]
### Added
- Redesigned popup (Detected / History / Settings), light/dark/system theme, English + Spanish.
- Persistent, searchable **download history** (grouped by day, show in folder, open page, copy URL, export JSON, flags missing files).
- **Download queue** (1–4 simultaneous) and **Download all**.
- **Audio-only (M4A)** mode that skips video segments when possible.
- Live **speed and ETA**, estimated size, durations for HLS masters, page **thumbnails**.
- **Notifications**, **file-name template** with live preview, copy stream URL / ffmpeg command.
- Settings: parallel segments, size cap, ask-where-to-save, keep history.
- DRM detection for HLS masters before downloading.
- GitHub scaffolding: issue/PR templates, SECURITY, PRIVACY, architecture docs, store listing text.
### Changed
- New icon.
### Tests
- 18 engine tests, 40+ browser e2e checks (history, queue, audio-only, templates, settings, UI, screenshots).

## [1.0.0]
- Initial release: HLS/DASH/blob detection, MP4 muxer, AES-128, Referer emulation, auto-download, size limit, 1-hour+ videos.
