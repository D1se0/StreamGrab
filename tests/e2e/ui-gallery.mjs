// Design gallery: renders the REAL popup (dist/chrome) with simulated extension state and audits every screen in
// light/dark × en/es. Fast (no extension needed): the chrome.* API is shimmed. Run: npm run test:gallery
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../helpers/server.mjs';
import { AUDIT_SOURCE } from '../helpers/ui-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME_BIN || fs.readdirSync('/tmp/chr').map((d) => path.join('/tmp/chr', d, 'chrome')).find(fs.existsSync);
const shotDir = path.join(root, 'docs', 'screenshots'); const tmpShots = path.join(root, 'tests', 'e2e', 'gallery'); fs.mkdirSync(process.env.SCREENSHOTS ? shotDir : tmpShots, { recursive: true });

// ---------- mock data ----------
const U = (p) => `https://cdn.example-learning.com/hls/${p}`;
const opts = [['1080p · 6.4 Mbps', 1080, 6.4e6], ['720p · 3.1 Mbps', 720, 3.1e6], ['480p · 1.4 Mbps', 480, 1.4e6], ['360p · 700 kbps', 360, 7e5]].map(([label, height, bandwidth], i) => ({ id: String(i), label, height, bandwidth }));
const item = (o) => ({ kind: 'hls', size: 0, ct: '', pageUrl: 'https://www.example-learning.com/course/12/lesson/992', title: 'Lesson 12 – Introduction to reverse engineering', state: 'ready', options: opts, hidden: false, duration: 5025, t: Date.now(), ...o });
const job = (o) => ({ id: 'j1', status: 'running', phase: 'download', pct: 37, bytes: 412e6, speed: 8.4e6, eta: 94, quality: '1080p', error: '', ...o });
const LONG = 'Módulo 07 – Análisis estático y dinámico de binarios ELF: técnicas avanzadas de depuración con GDB, pwndbg y radare2 (sesión completa con ejercicios)';
const UNBROKEN = 'a'.repeat(90);
const screens = {
  'detected-ready': { items: [item({ id: 'a', url: U('master.m3u8'), title: LONG }), item({ id: 'b', kind: 'dash', url: U('manifest.mpd'), options: [opts[0]], duration: 0, title: 'DASH single option, no duration' }), item({ id: 'c', kind: 'file', url: 'https://cdn.example.com/video/clip.mp4', options: [], size: 52428800, duration: 0, title: UNBROKEN })] },
  'detected-progress': { items: [item({ id: 'a', url: U('a.m3u8'), job: job({ status: 'running' }) }), item({ id: 'b', url: U('b.m3u8'), title: 'Queued download', job: job({ id: 'j2', status: 'queued', pct: 0 }) }), item({ id: 'c', url: U('c.m3u8'), title: 'Building the MP4', job: job({ id: 'j3', status: 'muxing', pct: 100 }) }), item({ id: 'd', url: U('d.m3u8'), state: 'analyzing', options: [], title: 'Analysing…' })] },
  'detected-results': { items: [item({ id: 'a', url: U('a.m3u8'), job: job({ status: 'done', pct: 100, size: 903e6, downloadId: 3 }) }), item({ id: 'b', url: U('b.m3u8'), title: 'Failed download', job: job({ id: 'j2', status: 'error', error: 'HTTP 403 for https://cdn.example-learning.com/hls/very/long/path/segment_0001.ts?token=abcdef0123456789abcdef0123456789' }) }), item({ id: 'c', url: U('c.m3u8'), title: 'Protected stream', problem: 'drm', options: [opts[0]] }), item({ id: 'd', url: U('d.m3u8'), live: true, duration: 0, title: 'Live event' }), item({ id: 'e', url: U('e.m3u8'), title: 'Cancelled one', job: job({ id: 'j5', status: 'cancelled' }) }), item({ id: 'f', url: U('f.m3u8'), title: 'Size limit hit', job: job({ id: 'j6', status: 'error', error: 'SIZE_LIMIT:1073741824' }) })] },
  'empty': { items: [] }, 'empty-blob': { items: [], blob: true },
};
const hist = (n) => Array.from({ length: n }, (_, k) => {
  const err = k % 7 === 3, audio = k % 5 === 2;
  return { id: `h${k}`, title: k % 6 === 0 ? LONG : `Lesson ${k + 1} – Topic`, filename: (k % 6 === 0 ? LONG : `Lesson ${k + 1} – Topic`) + (audio ? ' [audio].m4a' : ' [1080p].mp4'), site: 'example-learning.com', pageUrl: 'https://www.example-learning.com/c', url: U(`h${k}.m3u8`), kind: 'hls', quality: audio ? 'audio' : '1080p', mode: audio ? 'audio' : 'both', ext: audio ? 'm4a' : 'mp4', size: err ? 0 : (k + 1) * 31e6, duration: err ? 0 : 600 + k * 97, date: Date.now() - k * 5.5 * 3600e3, status: err ? 'error' : 'done', error: err ? 'HTTP 404 for https://cdn.example-learning.com/hls/segment_12.ts' : '', downloadId: k, exists: k % 9 !== 4, thumb: k % 3 === 0 ? '' : 'THUMB' };
});
const THUMB = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="120"><defs><linearGradient id="g"><stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs><rect width="192" height="120" fill="url(#g)"/><circle cx="96" cy="60" r="26" fill="#fff" opacity=".7"/></svg>')}`;
const historyData = hist(40).map((x) => ({ ...x, thumb: x.thumb === 'THUMB' ? THUMB : '' }));
const CASES = [
  ['detected-ready', 'detected'], ['detected-progress', 'detected'], ['detected-results', 'detected'], ['empty', 'detected'], ['empty-blob', 'detected'],
  ['history-many', 'history'], ['history-empty', 'history'], ['settings', 'settings'],
];
const shim = (state, history, cfg) => `(() => {
  const state = ${JSON.stringify(state)}, history = ${JSON.stringify(history)}; let cfg = ${JSON.stringify(cfg)};
  const THUMB = ${JSON.stringify(THUMB)};
  const chrome = {
    runtime: { getManifest: () => ({ version: '1.1.2', homepage_url: 'https://github.com/example/streamgrab' }),
      sendMessage: async (m) => { switch (m.type) { case 'getState': return { items: state.items, blob: !!state.blob, settings: cfg, activeJobs: state.items.filter((i) => i.job && ['running','queued','muxing'].includes(i.job.status)).length, historyCount: history.length };
        case 'getHistory': return { history }; case 'setSettings': cfg = { ...cfg, ...m.settings }; return cfg; default: return {}; } } },
    tabs: { query: async () => [{ id: 1, url: 'https://www.example-learning.com/course/12/lesson/992', favIconUrl: '' }], get: async () => ({ id: 1, url: 'https://www.example-learning.com/course/12/lesson/992', favIconUrl: '' }), sendMessage: async () => ({ thumb: THUMB }) },
  };
  Object.defineProperty(window, 'chrome', { value: chrome, configurable: true });
})()`;

const S = await serve(path.join(root, 'dist', 'chrome'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
let failed = 0, checked = 0; const report = [];
try {
  for (const theme of ['light', 'dark']) for (const lang of ['en', 'es']) for (const [name, view] of CASES) {
    const state = screens[name] || { items: [] }; const history = name === 'history-many' ? historyData : name === 'history-empty' ? [] : historyData;
    const cfg = { auto: false, concurrency: 6, maxParallel: 2, saveAs: false, maxGB: 0, notify: true, history: true, theme, lang, template: '{title} [{quality}]' };
    const page = await browser.newPage(); await page.setViewport({ width: 440, height: 580, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument(shim(state, history, cfg));
    await page.goto(`${S.base}/popup.html?view=${view}`); await new Promise((r) => setTimeout(r, 700));
    if (name === 'history-many') await page.hover('.h'); // reveal hover actions in screenshot
    if (process.env.BREAK_CSS) await page.addStyleTag({ content: process.env.BREAK_CSS }); // self-test of the audit: inject a deliberate defect
    const issues = await page.evaluate(AUDIT_SOURCE); checked++;
    if (issues.length) { failed++; report.push(`FAIL ${theme}/${lang}/${name}:\n   - ${[...new Set(issues)].slice(0, 8).join('\n   - ')}`); }
    if (name === 'detected-ready' && theme === 'light' && lang === 'en') { // re-render must not replay the entrance animation (flicker)
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.card')).animationName === 'none', { timeout: 3000 }).catch(() => {});
      await page.select('.card select', '2'); await new Promise((r) => setTimeout(r, 250));
      const anim = await page.evaluate(() => [...document.querySelectorAll('.card')].map((c) => getComputedStyle(c).animationName));
      const kept = await page.$eval('.card select', (s) => s.value);
      checked++; if (anim.some((a) => a !== 'none') || kept !== '2') { failed++; report.push(`FAIL re-render: cards animate again (${anim.join(',')}) or lost the chosen quality (${kept})`); }
    }
    const want = (theme === 'light' && lang === 'en') || (theme === 'dark' && lang === 'es');
    if (want || process.env.GALLERY_ALL) await page.screenshot({ path: path.join(process.env.SCREENSHOTS ? shotDir : tmpShots, `g-${theme}-${lang}-${name}.png`) });
    if (theme === 'light' && lang === 'en' && ['detected-ready', 'history-many'].includes(name)) { // full-length render for design review
      await page.addStyleTag({ content: 'body{height:auto!important;overflow:visible!important}main{overflow:visible!important}' });
      await page.screenshot({ path: path.join(tmpShots, `full-${name}.png`), fullPage: true });
    }
    await page.close();
  }
} finally { await browser.close(); S.close(); }
console.log(report.join('\n') || `PASS  ${checked} screens audited (overflow, clipped text, spill-out, tap targets, WCAG AA contrast)`);
if (failed) console.log(`\n${failed}/${checked} screens have design issues`);
process.exit(failed ? 1 : 0);
