// Builds dist/chrome and dist/firefox (+ optional zips with --zip). Chromium-based browsers (Edge, Brave, Opera, Vivaldi) use the chrome build.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zip = process.argv.includes('--zip');

const common = {
  manifest_version: 3,
  name: 'StreamGrab – HLS/DASH/Blob Video Downloader',
  short_name: 'StreamGrab',
  version: pkg.version,
  description: 'Detects HLS, DASH and blob: videos on the page and downloads them as one playable MP4 (video + audio) – no need to play them.',
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  action: { default_popup: 'popup.html', default_title: 'StreamGrab', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } },
  permissions: ['webRequest', 'downloads', 'storage', 'tabs', 'declarativeNetRequest'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    { matches: ['<all_urls>'], js: ['inject-main.js'], run_at: 'document_start', all_frames: true, match_about_blank: true, world: 'MAIN' },
    { matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_start', all_frames: true, match_about_blank: true },
  ],
};
const targets = {
  chrome: {
    manifest: { ...common, minimum_chrome_version: '116', permissions: [...common.permissions, 'offscreen'], background: { service_worker: 'background.js' } },
    entries: ['background', 'engine-page', 'popup', 'content', 'inject-main'], define: { __FIREFOX__: 'false' },
    extra: ['engine.html'],
  },
  firefox: {
    manifest: {
      // Firefox requires the explicit "downloads.open" permission; declaring it in Chrome MV3 (tested Chromium 143) makes the extension fail to load, so it stays Firefox-only
      ...common, permissions: [...common.permissions, 'downloads.open'], background: { scripts: ['background.js'] },
      browser_specific_settings: { gecko: { id: 'streamgrab@users.noreply.github.com', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } }, gecko_android: { strict_min_version: '142.0' } },
    },
    entries: ['background', 'popup', 'content', 'inject-main'], define: { __FIREFOX__: 'true' }, extra: [],
  },
};

for (const [name, t] of Object.entries(targets)) {
  const out = path.join(root, 'dist', name);
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  await build({
    entryPoints: t.entries.map((e) => path.join(root, 'src', `${e}.js`)), outdir: out, bundle: true, format: 'iife',
    target: ['chrome116', 'firefox128'], minify: false, legalComments: 'none', define: t.define, logLevel: 'warning',
  });
  for (const f of ['popup.html', 'popup.css', ...t.extra]) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));
  fs.cpSync(path.join(root, 'src', 'icons'), path.join(out, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(t.manifest, null, 2));
  console.log(`built dist/${name}`);
  if (zip) {
    const z = path.join(root, 'dist', `streamgrab-${name}-v${pkg.version}.zip`); fs.rmSync(z, { force: true });
    execFileSync('zip', ['-qr', z, '.'], { cwd: out }); console.log(`zipped ${path.relative(root, z)}`);
  }
}
