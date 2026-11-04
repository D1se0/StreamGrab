// End-to-end test: loads the BUILT extension in real Chromium, visits pages, checks detection + downloads.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from '../helpers/server.mjs';
import { probe, decodeErrors } from '../helpers/ffprobe.mjs';
import { checkTabs } from '../helpers/tabs-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const ext = path.join(root, 'dist', 'chrome');
const CHROME = process.env.CHROME_BIN || fs.readdirSync('/tmp/chr').map((d) => path.join('/tmp/chr', d, 'chrome')).find(fs.existsSync);
if (!CHROME) throw new Error('Set CHROME_BIN to a Chromium binary (not branded Chrome 137+, which dropped --load-extension)');

// serve fixtures + site, plus a /protected copy of the TS ladder and "disguised" manifests
const www = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-www-'));
fs.cpSync(path.join(root, 'tests', 'fixtures'), www, { recursive: true });
fs.cpSync(path.join(root, 'tests', 'site'), www, { recursive: true });
fs.cpSync(path.join(www, 'hls_ts'), path.join(www, 'protected'), { recursive: true });
const m3u8 = fs.readFileSync(path.join(www, 'hls_ts', 'hi.m3u8'), 'utf8').replace(/hi_/g, '/hls_ts/hi_');
const disguised = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(m3u8); };
const S = await serve(www, { routes: { '/api/getstream': disguised, '/api/getstream2': disguised } });

const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-dl-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-prof-'));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', userDataDir: profile, protocolTimeout: 90000,
  args: ['--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'],
});
const results = []; let failed = 0;
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; console.log(results.at(-1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, step = 250) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } }

try {
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  (await sw.worker()).on('console', (m) => process.env.DEBUG_SW && console.log('[sw]', m.text()));
  check('extension loaded (MV3 service worker running)', !!extId, extId);

  const ctrl = await browser.newPage(); // extension page used to drive/query the background like the popup does
  await ctrl.goto(`chrome-extension://${extId}/popup.html`);
  const msg = (m) => ctrl.evaluate((mm) => chrome.runtime.sendMessage(mm), m);
  const tabIdFor = (urlPart) => ctrl.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url.includes(u))?.id, urlPart);
  const state = async (tabId) => msg({ type: 'getState', tabId });
  const filesInDl = () => fs.readdirSync(dlDir).filter((f) => f.endsWith('.mp4'));

  // 1) blob/MSE page with HLS ladder
  const page = await browser.newPage();
  await page.goto(`${S.base}/index.html`);
  const tabId = await tabIdFor('/index.html');
  const st = await until(async () => { const s = await state(tabId); return s.items.find((i) => i.kind === 'hls' && i.state === 'ready' && i.options.length === 2) && s; });
  check('HLS master detected on page playing through blob: (hls.js/MSE)', !!st);
  check('only master listed (variant playlists hidden)', st && st.items.filter((i) => i.kind === 'hls').length === 1, st && st.items.map((i) => i.url.split('/').pop()).join(','));
  const item = st.items.find((i) => i.kind === 'hls');
  check('qualities offered best-first', item.options[0].label.startsWith('360p') && item.options[1].label.startsWith('180p'), item.options.map((o) => o.label).join(' | '));
  const badge = await ctrl.evaluate(async (id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  check('toolbar badge shows count', badge === '1', `"${badge}"`);

  // 2) download best quality (tab stays open, but the video is NOT being played/needed)
  await page.evaluate(() => document.getElementById('v').pause());
  await msg({ type: 'download', tabId, itemId: item.id, optionId: '0' });
  const done = await until(async () => { const s = await state(tabId); const j = s.items.find((i) => i.id === item.id)?.job; return j && (j.status === 'done' || j.status === 'error') && j; }, 60000);
  check('download job completed', done?.status === 'done', done?.error || JSON.stringify(done));
  const f1 = await until(() => filesInDl()[0], 15000);
  check('MP4 file written to Downloads', !!f1, f1);
  if (f1) {
    const file = path.join(dlDir, f1); const info = probe(file);
    check('MP4: H.264 video + AAC audio, 640x360', info.v?.codec_name === 'h264' && info.a?.codec_name === 'aac' && info.v.width === 640, `${info.v?.width}x${info.v?.height}`);
    check('MP4: duration ~12 s and all 300 frames', Math.abs(info.duration - 12) < 0.3 && info.frames === 300, `${info.duration}s ${info.frames}f`);
    check('MP4: decodes without errors', decodeErrors(file) === '');
    // (CDP download mode renames files to GUIDs, so check the name the extension asked the browser to use)
    check('filename uses page title + quality', /^Demo Player.*\[360p\]\.mp4$/.test(done.filename), done.filename);
  }

  // 3) Hotlink-protected stream (needs Referer emulation via declarativeNetRequest)
  const p3 = await browser.newPage();
  await p3.goto(`${S.base}/index.html?src=/protected/master.m3u8`);
  const tab3 = await tabIdFor('src=/protected');
  const st3 = await until(async () => { const s = await state(tab3); return s.items.find((i) => i.kind === 'hls' && i.state === 'ready' && !i.problem) && s; });
  check('Referer-protected HLS analysed OK', !!st3, st3 ? '' : JSON.stringify((await state(tab3)).items.map((i) => [i.url.split('/').pop(), i.state, i.problem])));
  const it3 = st3?.items.find((i) => i.kind === 'hls');
  const before = filesInDl().length;
  if (it3) await msg({ type: 'download', tabId: tab3, itemId: it3.id, optionId: '1' });
  const done3 = it3 && await until(async () => { const s = await state(tab3); const j = s.items.find((i) => i.id === it3.id)?.job; return j && ['done', 'error'].includes(j.status) && j; }, 60000);
  check('Referer-protected HLS downloaded (lowest quality)', done3?.status === 'done' && filesInDl().length === before + 1, done3?.error || '');
  await p3.close();

  // 4) manifests with no extension / generic content-type found by body sniffing
  const p4 = await browser.newPage();
  await p4.goto(`${S.base}/hidden.html`);
  const tab4 = await tabIdFor('/hidden.html');
  const st4 = await until(async () => { const s = await state(tab4); return s.items.filter((i) => i.kind === 'hls' && i.state === 'ready').length >= 2 && s; });
  check('disguised manifests (fetch + XHR, text/plain) sniffed', !!st4, st4 ? st4.items.map((i) => i.url.split('/').pop()).join(',') : (await state(tab4)).items.length + ' items');
  check('page flagged as using MediaSource blob', (await state(tab4)).blob === true);
  await p4.close();

  // 4b) DASH: separate fMP4 audio + video merged into one MP4 inside the extension
  const pd = await browser.newPage();
  await pd.goto(`${S.base}/dash.html`);
  const tabD = await tabIdFor('/dash.html');
  const stD = await until(async () => { const s = await state(tabD); return s.items.find((i) => i.kind === 'dash' && i.state === 'ready' && !i.problem) && s; });
  check('DASH manifest (.mpd) detected', !!stD);
  const nD = filesInDl().length; const itD = stD?.items.find((i) => i.kind === 'dash');
  if (itD) await msg({ type: 'download', tabId: tabD, itemId: itD.id, optionId: '0' });
  const doneD = itD && await until(async () => { const s = await state(tabD); const j = s.items.find((i) => i.id === itD.id)?.job; return j && ['done', 'error'].includes(j.status) && j; }, 60000);
  check('DASH downloaded', doneD?.status === 'done', doneD?.error || '');
  const newest = await until(() => (filesInDl().length > nD ? filesInDl().map((f) => path.join(dlDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] : null), 15000);
  if (newest) { const i = probe(newest); check('DASH MP4: video+audio merged, 300 frames, decodes', i.v?.codec_name === 'h264' && i.a?.codec_name === 'aac' && i.frames === 300 && decodeErrors(newest) === '', `${i.duration}s`); }
  await pd.close();

  // 4c) 1-hour stream inside the extension (regression: "Maximum call stack size exceeded") + size-limit setting
  if (fs.existsSync(path.join(www, 'hls_long', 'index.m3u8'))) {
    const pl = await browser.newPage();
    await pl.goto(`${S.base}/index.html?src=/hls_long/index.m3u8`);
    const tabL = await tabIdFor('hls_long');
    const stL = await until(async () => { const s = await state(tabL); return s.items.find((i) => i.kind === 'hls' && i.state === 'ready' && !i.problem) && s; });
    const itL = stL?.items.find((i) => i.kind === 'hls');
    await msg({ type: 'setSettings', settings: { maxGB: 0.01 } }); // 10 MB limit -> must stop cleanly
    if (itL) await msg({ type: 'download', tabId: tabL, itemId: itL.id, optionId: '0' });
    const lim = itL && await until(async () => { const s = await state(tabL); const j = s.items.find((i) => i.id === itL.id)?.job; return j && ['done', 'error'].includes(j.status) && j; }, 60000);
    check('size limit honoured (stops with SIZE_LIMIT)', lim?.status === 'error' && /SIZE_LIMIT/.test(lim.error), lim?.error || lim?.status);
    await msg({ type: 'setSettings', settings: { maxGB: 0 } }); // unlimited
    const nL = filesInDl().length;
    if (itL) await msg({ type: 'download', tabId: tabL, itemId: itL.id, optionId: '0' });
    const doneL = itL && await until(async () => { const s = await state(tabL); const j = s.items.find((i) => i.id === itL.id)?.job; return j && ['done'].includes(j.status) || (j?.status === 'error' && j.id !== lim?.id) ? j : null; }, 120000, 500);
    check('1-hour video downloaded (no limit)', doneL?.status === 'done', doneL?.error || '');
    const fL = await until(() => (filesInDl().length > nL ? filesInDl().map((f) => path.join(dlDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] : null), 20000);
    if (fL) { const i = probe(fL); check('1-hour MP4: 108000 frames, 3600 s, decodes', i.frames === 108000 && Math.abs(i.duration - 3600) < 0.5 && decodeErrors(fL) === '', `${i.frames}f ${i.duration}s`); }
    await pl.close();
  }

  // 5) auto-download mode: reload and it downloads by itself
  await msg({ type: 'setSettings', settings: { auto: true } });
  const n0 = filesInDl().length;
  const p5 = await browser.newPage();
  await p5.goto(`${S.base}/index.html`);
  const got = await until(() => filesInDl().length > n0, 60000, 500);
  check('auto-download: reload page -> MP4 saved without clicking anything', !!got);
  await msg({ type: 'setSettings', settings: { auto: false } });

  // 6) history: every finished download is recorded and survives
  const hist = async () => (await msg({ type: 'getHistory' })).history;
  const h0 = await hist();
  check('history records finished downloads (title, quality, size, status, site)', h0.length >= 5 && h0.every((x) => x.status && x.title && x.date) && h0.some((x) => x.status === 'done' && x.quality && x.size > 0 && x.site), `${h0.length} entries`);
  check('history flags error entries (size-limit attempt is there)', h0.some((x) => x.status === 'error' && /SIZE_LIMIT/.test(x.error)));

  // 7) audio-only (M4A): no video segments, only audio stream out
  const tab7 = await tabIdFor('/index.html'); const st7 = await state(tab7); const it7 = st7.items.find((i) => i.kind === 'hls');
  const nA = filesInDl().length;
  await msg({ type: 'download', tabId: tab7, itemId: it7.id, optionId: '0', mode: 'audio' });
  const doneA = await until(async () => { const j = (await state(tab7)).items.find((i) => i.id === it7.id)?.job; return j && j.mode === 'audio' && ['done', 'error'].includes(j.status) && j; }, 60000);
  check('audio-only job completed, named .m4a', doneA?.status === 'done' && /\.m4a$/.test(doneA.filename), doneA?.filename || doneA?.error);
  const fA = await until(() => (filesInDl().length > nA ? filesInDl().map((f) => path.join(dlDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] : null), 15000);
  if (fA) { const i = probe(fA); check('audio-only file: AAC only, no video, ~12 s, decodes', !i.v && i.a?.codec_name === 'aac' && Math.abs(i.duration - 12) < 0.3 && decodeErrors(fA) === ''); }

  // 8) filename template setting
  await msg({ type: 'setSettings', settings: { template: '{site}_{title}_{quality}' } });
  await msg({ type: 'download', tabId: tab7, itemId: it7.id, optionId: '1' });
  const doneT = await until(async () => { const j = (await state(tab7)).items.find((i) => i.id === it7.id)?.job; return j && j.filename.startsWith('127.0.0.1_') && ['done', 'error'].includes(j.status) && j; }, 60000);
  check('custom filename template applied', doneT?.status === 'done' && /^127\.0\.0\.1_Demo Player.*_180p\.mp4$/.test(doneT.filename), doneT?.filename);
  await msg({ type: 'setSettings', settings: { template: '{title} [{quality}]' } });

  // 9) queue: maxParallel=1, "download all" on a page with two manifests -> one runs, one waits
  await msg({ type: 'setSettings', settings: { maxParallel: 1 } });
  const p9 = await browser.newPage(); await p9.goto(`${S.base}/hidden.html`);
  const tab9 = await tabIdFor('/hidden.html');
  await until(async () => (await state(tab9)).items.filter((i) => i.state === 'ready').length >= 2);
  const nQ = filesInDl().length;
  const r9 = await msg({ type: 'downloadAll', tabId: tab9 });
  const s9 = await state(tab9); const statuses = s9.items.map((i) => i.job?.status);
  check('"Download all" starts every item; extra ones wait in the queue (maxParallel=1)', r9.started === 2 && statuses.includes('queued') && statuses.some((x) => x === 'running'), statuses.join(','));
  const both = await until(async () => (await state(tab9)).items.every((i) => i.job?.status === 'done'), 90000, 500);
  check('queued download starts automatically and both finish', !!both && filesInDl().length >= nQ + 2);
  await p9.close();

  // 10) settings are validated + persisted
  const cfg = await msg({ type: 'setSettings', settings: { maxParallel: 99, concurrency: 0, theme: 'dark', lang: 'es', bogus: 1 } });
  check('settings clamped/persisted, unknown keys ignored', cfg.maxParallel === 4 && cfg.concurrency === 6 && cfg.theme === 'dark' && cfg.bogus === undefined, JSON.stringify(cfg));
  await msg({ type: 'setSettings', settings: { maxParallel: 2, theme: 'light', lang: 'en' } });

  // 11) popup UI: detected tab (thumbnail), history tab, settings tab (+ dark/Spanish variant)
  const shotDir = process.env.SCREENSHOTS ? path.join(root, 'docs', 'screenshots') : path.join(root, 'tests', 'e2e'); fs.mkdirSync(shotDir, { recursive: true });
  const ui = await browser.newPage(); await ui.setViewport({ width: 440, height: 580, deviceScaleFactor: 2 });
  const open = async (view, tabArg) => { await ui.goto(`chrome-extension://${extId}/popup.html?view=${view}&tab=${tabArg}`); await ui.bringToFront(); await sleep(1300); };
  await open('detected', tab7);
  const cards = await ui.$$eval('.card', (c) => c.length);
  const thumbOk = await ui.$eval('.thumb img', (i) => i.complete && i.naturalWidth > 0).catch(() => false);
  check('popup: detected tab renders cards with page thumbnail (og:image)', cards >= 1 && thumbOk, `${cards} card(s)`);
  check('popup: quality select + Video/Audio switch + copy buttons present', (await ui.$$eval('.card select', (x) => x.length)) === 1 && (await ui.$$eval('.seg button', (x) => x.length)) === 2 && (await ui.$$eval('.card .acts button', (x) => x.length)) >= 2);
  await ui.screenshot({ path: path.join(shotDir, '1-detected.png') });
  await open('history', tab7);
  const rows = await ui.$$eval('.h', (x) => x.length);
  check('popup: history tab lists downloads grouped by day', rows >= 5 && (await ui.$$eval('.day', (x) => x.length)) >= 1, `${rows} rows`);
  await ui.type('input[type=search]', 'zzz-no-match'); await sleep(500);
  check('popup: history search filters', (await ui.$$eval('.h', (x) => x.length)) === 0);
  await ui.$eval('input[type=search]', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); }); await sleep(500);
  await ui.screenshot({ path: path.join(shotDir, '2-history.png') });
  await open('settings', tab7);
  check('popup: settings tab renders all controls', (await ui.$$eval('.s', (x) => x.length)) >= 10);
  await ui.screenshot({ path: path.join(shotDir, '3-settings.png') });
  await msg({ type: 'setSettings', settings: { theme: 'dark', lang: 'es' } });
  await open('detected', tab7); await ui.screenshot({ path: path.join(shotDir, '4-detected-dark-es.png') });
  const dark = await ui.evaluate(() => document.documentElement.dataset.theme);
  check('popup: dark theme + Spanish applied', dark === 'dark' && (await ui.$eval('.tab.on', (e) => e.textContent)).includes('Detectados'));
  await msg({ type: 'setSettings', settings: { theme: 'auto', lang: 'auto' } });

  // 11b) live progress (speed / ETA) – slow server, screenshot mid-download
  if (fs.existsSync(path.join(www, 'hls_long', 'index.m3u8'))) {
    const ps = await browser.newPage(); await ps.goto(`${S.base}/index.html?src=/slow/index.m3u8`);
    const tabS = await tabIdFor('/slow/index.m3u8');
    const stS = await until(async () => { const s = await state(tabS); return s.items.find((i) => i.kind === 'hls' && i.state === 'ready') && s; });
    const itS = stS?.items.find((i) => i.kind === 'hls');
    check('HLS media playlist: duration/size estimate available at detection', itS && Math.abs(itS.duration - 3600) < 1, String(itS?.duration));
    if (itS) await msg({ type: 'download', tabId: tabS, itemId: itS.id, optionId: '0' });
    const prog = await until(async () => { const j = (await state(tabS)).items.find((i) => i.id === itS?.id)?.job; return j && j.status === 'running' && j.pct >= 25 && j.speed > 0 && j; }, 30000, 150);
    check('live progress exposes %, speed and ETA', !!prog && prog.eta != null, prog ? `${prog.pct}% ${Math.round(prog.speed / 1024)} KB/s eta ${prog.eta}s` : 'no progress seen');
    await ui.goto(`chrome-extension://${extId}/popup.html?tab=${tabS}`); await sleep(500);
    await ui.screenshot({ path: path.join(shotDir, '5-progress.png') });
    await until(async () => ['done', 'error'].includes((await state(tabS)).items.find((i) => i.id === itS?.id)?.job?.status), 90000, 500);
    await ps.close();
  }

  // 11c) tab switching with REAL clicks: exactly one section visible, no overlap, no stale content (regression: sections stacked)
  await open('detected', tab7);
  const tabsRes = await checkTabs(ui);
  check('tabs: only the selected section is visible, nothing overlaps or leaks between sections (real clicks, 3 orders)', tabsRes.ok, tabsRes.detail);
  const clickTab = async (id) => { await ui.click(`.tab[data-tab="${id}"]`); await sleep(700); };
  await clickTab('history'); await ui.screenshot({ path: path.join(shotDir, '2-history.png') });
  await clickTab('detected');
  const emptyShownWithItems = await ui.$eval('#empty', (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0);
  check('tabs: "empty" placeholder hidden when items exist', emptyShownWithItems === false);
  // empty states must not bleed either: a tab with no detections
  const pe = await browser.newPage(); await pe.goto(`${S.base}/hls_ts/master.m3u8`); // plain manifest URL (no player): nothing blob-like to flag
  const ui2 = await browser.newPage(); await ui2.setViewport({ width: 440, height: 580 });
  const blank = await browser.newPage(); await blank.goto('about:blank'); const tabBlank = await tabIdFor('about:blank');
  await ui2.goto(`chrome-extension://${extId}/popup.html?tab=${tabBlank}`); await ui2.bringToFront(); await sleep(900);
  const emptyOk = await ui2.evaluate(() => { const vis = (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; return vis(document.querySelector('#empty')) && document.querySelectorAll('#list .card').length === 0 && !vis(document.querySelector('#tab-history')) && !vis(document.querySelector('#tab-settings')); });
  check('tabs: empty state shows alone when nothing detected', emptyOk);
  await ui2.click('.tab[data-tab="history"]'); await sleep(600);
  const histEmptyAlone = await ui2.evaluate(() => { const vis = (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; return !vis(document.querySelector('#empty')) && !vis(document.querySelector('#tab-detected')); });
  check('tabs: history tab never shows the detected "empty" placeholder', histEmptyAlone);
  await pe.close(); await ui2.close(); await blank.close();

  // 12) history management
  const hBefore = (await hist()).length;
  await msg({ type: 'historyDelete', id: (await hist())[0].id });
  check('history: delete one entry', (await hist()).length === hBefore - 1);
  await msg({ type: 'historyClear' });
  check('history: clear all', (await hist()).length === 0);
  await msg({ type: 'setSettings', settings: { history: false } });
  const tab12 = await tabIdFor('/index.html'); const it12 = (await state(tab12)).items.find((i) => i.kind === 'hls');
  await msg({ type: 'download', tabId: tab12, itemId: it12.id, optionId: '1' });
  await until(async () => (await state(tab12)).items.find((i) => i.id === it12.id)?.job?.status === 'done', 60000);
  check('history: "keep history" off -> nothing recorded', (await hist()).length === 0);
  await msg({ type: 'setSettings', settings: { history: true } });
} catch (e) { check('e2e run aborted', false, e.stack); }
finally { await browser.close(); S.close(); }
fs.writeFileSync(path.join(root, 'tests', 'e2e', 'last-run.txt'), results.join('\n') + '\n');
console.log(failed ? `\n${failed} FAILED` : '\nALL E2E CHECKS PASSED'); process.exit(failed ? 1 : 0);
