// End-to-end test: loads the BUILT extension in real Chromium, visits pages, checks detection + downloads.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from '../helpers/server.mjs';
import { probe, decodeErrors } from '../helpers/ffprobe.mjs';

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
const results = []; let failed = 0;
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; console.log(results.at(-1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, step = 250) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } }

/** Chromium (143 system build) races when registering command-line-loaded extensions in headless=new: the extension is sometimes not registered at all and the SW target never appears. It reproduces with the pristine v1.0.0 build too, so nothing to do with the extension itself: retry the launch. */
async function launchBrowser() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-prof-'));
    const browser = await puppeteer.launch({
      executablePath: CHROME, headless: process.env.SG_HEADLESS === '0' ? false : 'new', userDataDir: profile,
      args: ['--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-gpu', '--enable-logging=stderr'],
      pipe: false,
    });
    const dbgLines = [];
    const stderr = browser.process?.()?.stderr; // capture the browser's own boot log for the failure annotation
    if (stderr) stderr.on('data', (chunk) => { if (dbgLines.length < 400) dbgLines.push(chunk.toString()); });
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 15000 }).catch(() => null);
    if (sw) return { browser, extId: new URL(sw.url()).host, sw };
    let extId = null;
    const man = await browser.newPage(); // fallback: get the id from chrome://extensions and wake the SW with one popup.html load
    await man.goto('chrome://extensions/', { waitUntil: 'load' }).catch(() => {});
    extId = await until(async () => man.evaluate(() => {
      const mgr = document.querySelector('extensions-manager');
      if (!mgr || !mgr.shadowRoot) return null;
      for (const it of mgr.shadowRoot.querySelectorAll('extensions-item')) {
        if ((it.shadowRoot.querySelector('#name')?.textContent || '').startsWith('StreamGrab')) return it.id;
      }
      return null;
    }).catch(() => null), 12000, 500);
    await man.close().catch(() => {});
    if (extId) {
      const wake = await browser.newPage(); // loading the popup sends getState and boots the extension's service worker
      await wake.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' }).catch(() => {});
      const sw2 = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 30000 }).catch(() => null);
      await wake.close().catch(() => {});
      if (sw2) return { browser, extId, sw: sw2 };
    }
    console.log(`(attempt ${attempt}: chromium did not register the extension, relaunching)`);
    if (attempt === 5) console.log('DIAG chromium stderr tail:\n' + dbgLines.slice(-15));
    await browser.close().catch(() => {});
    await sleep(1000);
  }
  throw new Error('chromium failed to register the extension after 5 attempts (environment flakiness)');
}

const { browser, extId, sw } = await launchBrowser();

try {
  check('extension loaded (MV3 service worker running)', !!sw, extId);
  (await sw.worker()).on('console', (m) => process.env.DEBUG_SW && console.log('[sw]', m.text()));

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
  let diag = '';
  const st = await until(async () => {
    const s = await state(tabId);
    const ok = s && s.items.find((i) => i.kind === 'hls' && i.state === 'ready' && i.options.length === 2) && !s.items.some((i) => i.state === 'analyzing') && s; // settle: no variant still being analyzed
    diag = JSON.stringify(s?.items?.map((i) => [i.kind, i.state, i.problem || '', i.options?.length])) || 'no-tracker';
    return ok;
  }, 30000);
  if (!st) { console.log('DIAG section-1:', diag, 'tabs:', JSON.stringify(await ctrl.evaluate(async () => (await chrome.tabs.query({})).map((t) => [t.id, t.url])))); }
  check('HLS master detected on page playing through blob: (hls.js/MSE)', !!st);
  check('only master listed (variant playlists hidden)', st && st.items.filter((i) => i.kind === 'hls').length === 1, st && st.items.map((i) => i.url.split('/').pop()).join(','));
  const item = st.items.find((i) => i.kind === 'hls');
  check('qualities offered best-first', item.options[0].label.startsWith('360p') && item.options[1].label.startsWith('180p'), item.options.map((o) => o.label).join(' | '));
  const badge = await ctrl.evaluate(async (id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  check('toolbar badge shows count', badge === '1', `"${badge}"`);

  // 2) download best quality (tab stays open, but the video is NOT being played/needed)
  console.log('[e2e] step2: pausing video');
  await page.evaluate(() => document.getElementById('v').pause());
  console.log('[e2e] step2: sending download msg');
  await msg({ type: 'download', tabId, itemId: item.id, optionId: '0' });
  console.log('[e2e] step2: waiting job done');
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
  console.log('[e2e] step3: protected stream detected');
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

  // 6) popup UI renders (screenshot for manual review)
  const tab5 = await tabIdFor('/index.html');
  const ui = await browser.newPage(); await ui.setViewport({ width: 380, height: 360 });
  await ui.goto(`chrome-extension://${extId}/popup.html?tab=${tab5}`); await sleep(1200);
  const cards = await ui.$$eval('.card', (c) => c.length);
  check('popup renders detected items', cards >= 1, `${cards} card(s)`);
  await ui.screenshot({ path: path.join(root, 'tests', 'e2e', 'popup.png') });

  // 7) download history: recorded, re-downloadable, open/show, remove, clear + popup tab
  const hist = await msg({ type: 'getHistory' });
  check('history recorded completed downloads', hist.items.length >= 3, `${hist.items.length} entr${hist.items.length === 1 ? 'y' : 'ies'}, ${JSON.stringify(hist.stats)}`);
  const ent = hist.items.find((e) => /Demo Player.*\[360p\]\.mp4/.test(e.filename) && e.kind === 'hls');
  check('history entry has quality, size, stream URL and browser download id',
    !!ent && !!ent.quality && ent.size > 1000000 && /master\.m3u8$/.test(ent.srcUrl) && Number.isInteger(ent.dlId) && (ent.options || []).length === 2,
    ent ? `${ent.quality} ${(ent.size / 1048576).toFixed(1)} MB ${ent.srcUrl.split('/').pop()}` : 'missing');
  // re-download from history at a DIFFERENT quality than the recorded one (caller choice wins) -> new MP4 on disk
  const nR = filesInDl().length;
  const rd = await msg({ type: 'histDownload', histId: ent.id, optionId: '1' });
  check('re-download job started', !!rd?.jobId, JSON.stringify(rd));
  const jrd = rd?.jobId && await until(async () => { const hst = await msg({ type: 'getHistory' }); const j = hst.jobs.find((x) => x.id === rd.jobId); return j && ['done', 'error'].includes(j.status) ? j : null; }, 90000, 500);
  check('re-download from history completed', jrd?.status === 'done', jrd?.error || JSON.stringify(jrd));
  check('re-download asked for the lowest quality (180p)', /180p/.test(jrd?.quality || ''), jrd?.quality);
  check('re-download wrote a new MP4 file', filesInDl().length === nR + 1, `${filesInDl().length}`);
  const fR = filesInDl().map((f) => path.join(dlDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (fR && jrd?.status === 'done') { const i = probe(fR); check('re-downloaded MP4: video+audio, 300 frames, decodes', i.v?.codec_name === 'h264' && i.a?.codec_name === 'aac' && i.frames === 300 && decodeErrors(fR) === '', `${i.frames}f ${i.duration}s`); }
  const dlen0 = (await msg({ type: 'getHistory' })).items.length; // baseline AFTER the re-download (it adds its own history entry)
  await msg({ type: 'histRemove', histId: hist.items.at(-1).id });
  check('single entry removed from history', (await msg({ type: 'getHistory' })).items.length === dlen0 - 1);
  // popup history tab renders (before clearing)
  const ui2 = await browser.newPage(); await ui2.setViewport({ width: 380, height: 420 });
  await ui2.goto(`chrome-extension://${extId}/popup.html`); await sleep(300);
  await ui2.click('#tabHist'); await sleep(600);
  const hcards = await ui2.$$eval('#hlist .card', (c) => c.length);
  check('popup history tab renders downloaded items', hcards >= 3, `${hcards} card(s)`);
  const hstat = await ui2.$eval('#hstats', (el) => el.textContent);
  check('history stats line populated (count + total size)', /^\d+.+([KMG]B)/.test(hstat), hstat);
  const badges = await ui2.$$eval('#hlist .card .badge', (els) => els.map((e) => e.textContent));
  check('history cards carry kind badges', badges.every((b) => ['HLS', 'DASH', 'FILE'].includes(b)), badges.join(','));
  await ui2.screenshot({ path: path.join(root, 'tests', 'e2e', 'popup-history.png') });
  // search filters the list
  await ui2.type('#hsearch', 'Demo Player'); await sleep(600);
  const filtered = await ui2.$$eval('#hlist .card', (c) => c.length);
  check('history search filters entries', filtered >= 1 && filtered < hcards, `${filtered}/${hcards}`);
  await ui2.close();
  // clear-all wipes the history
  await msg({ type: 'histClear' });
  check('history cleared', (await msg({ type: 'getHistory' })).items.length === 0);
} catch (e) { check('e2e run aborted', false, e.stack); }
finally { await browser.close(); S.close(); }
fs.writeFileSync(path.join(root, 'tests', 'e2e', 'last-run.txt'), results.join('\n') + '\n');
console.log(failed ? `\n${failed} FAILED` : '\nALL E2E CHECKS PASSED'); process.exit(failed ? 1 : 0);
