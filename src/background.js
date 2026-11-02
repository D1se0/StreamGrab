// StreamGrab background: detects media requests, analyses manifests, runs downloads, keeps a download history.
import { analyzeManifest } from './core/analyze.js';
import { sanitizeFilename } from './core/util.js';

const api = globalThis.browser ?? globalThis.chrome;
/* global __FIREFOX__ */

let S = { media: {}, jobs: {}, seq: 0, dl: {} };
const settings = { auto: false, concurrency: 6, saveAs: false, maxGB: 0 }; // maxGB 0 = no size limit
let history = []; // completed downloads, newest first
let persistTimer, histPersistTimer;
const ready = (async () => {
  try { const s = await api.storage.session.get('state'); if (s.state) S = { ...S, ...s.state }; } catch { /* session storage unavailable */ }
  try {
    const l = await api.storage.local.get(['settings', 'history']);
    Object.assign(settings, l.settings || {});
    if (Array.isArray(l.history)) history = l.history;
  } catch { /* ignore */ }
})();
const persist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => api.storage.session.set({ state: S }).catch(() => {}), 150); };
const HIST_MAX = 200; // hard cap so storage.local can never fill with old entries
const persistHistory = () => {
  clearTimeout(histPersistTimer);
  histPersistTimer = setTimeout(() => api.storage.local.set({ history }).catch(() => {}), 300);
};
const histUnshift = (e) => { history.unshift(e); if (history.length > HIST_MAX) history = history.slice(0, HIST_MAX); persistHistory(); };
const histFind = (id) => history.find((h) => h.id === id);

// ---------- helpers ----------
const SEGMENT_EXT = /\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt|webvtt|key|jpg|jpeg|png|gif|webp|svg|ico|js|css|json|html?)$/i;
const FILE_EXT = /\.(mp4|webm|m4v|mov|mkv|ogv|mp3|m4a|ogg|opus|flac|wav)$/i;
const hdr = (headers, name) => headers?.find((h) => h.name.toLowerCase() === name)?.value || '';
function classify(d) {
  const ct = hdr(d.responseHeaders, 'content-type').split(';')[0].trim().toLowerCase();
  let path = ''; try { path = new URL(d.url).pathname; } catch { return null; }
  if (/\.m3u8$/i.test(path) || /mpegurl/.test(ct)) return { kind: 'hls', ct };
  if (/\.mpd$/i.test(path) || ct === 'application/dash+xml') return { kind: 'dash', ct };
  if (SEGMENT_EXT.test(path) || ct === 'video/mp2t' || ct === 'video/iso.segment' || ct === 'video/vnd.dlna.mpeg-tts') return null;
  const cr = /\/(\d+)$/.exec(hdr(d.responseHeaders, 'content-range'));
  const size = cr ? +cr[1] : +hdr(d.responseHeaders, 'content-length') || 0;
  if ((ct.startsWith('video/') || ct.startsWith('audio/') || (FILE_EXT.test(path) && !/html|json|text/.test(ct)) || ct === 'application/mp4') && size >= 300 * 1024 && d.statusCode < 400) return { kind: 'file', ct, size };
  return null;
}
const origin = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const tabEntry = (tabId) => (S.media[tabId] ||= { items: [], blob: false });

// ---------- Referer/Origin emulation for extension-initiated requests ----------
let ruleSeq = 1000 + Math.floor(Math.random() * 1e6);
async function addHeaderRule(pageUrl) {
  if (!pageUrl || !/^https?:/.test(pageUrl) || !api.declarativeNetRequest) return 0;
  const id = ++ruleSeq;
  const rule = { id, priority: id, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: pageUrl }, { header: 'origin', operation: 'set', value: origin(pageUrl) }] }, condition: { tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other', 'media'] } };
  try { await api.declarativeNetRequest.updateSessionRules({ addRules: [rule] }); return id; } catch { return 0; }
}
const removeHeaderRule = (id) => id && api.declarativeNetRequest?.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});

// ---------- detection ----------
async function addCandidate({ tabId, url, kind, size, ct, pageUrl }) {
  await ready;
  if (!/^https?:/i.test(url) || tabId < 0) return;
  const te = tabEntry(tabId);
  if (te.items.some((i) => i.url === url)) return;
  let title = '', tabUrl = ''; try { const tab = await api.tabs.get(tabId); title = tab.title || ''; tabUrl = tab.url || ''; } catch { /* tab gone */ }
  // `initiator` is origin-only; prefer a full document URL so Referer-checking servers are satisfied
  if (!pageUrl || /^https?:\/\/[^/]+$/.test(pageUrl)) pageUrl = tabUrl && origin(tabUrl) === origin(pageUrl || tabUrl) ? tabUrl : (pageUrl ? `${pageUrl}/` : tabUrl);
  const item = { id: `m${++S.seq}`, url, kind, size: size || 0, ct: ct || '', pageUrl: pageUrl || '', title, t: Date.now(), state: kind === 'file' ? 'ready' : 'analyzing', options: [], hidden: false };
  te.items.push(item); persist(); updateBadge(tabId);
  if (item.kind === 'file') { maybeAuto(tabId, item); return; }

  const rid = await addHeaderRule(item.pageUrl);

  try {
    const a = await analyzeManifest(url);

    item.kind = a.kind; item.options = a.options; item.problem = a.problem; item.duration = a.duration; item.live = a.live; item.isMaster = a.isMaster;
    item.state = 'ready';
    if (a.childUrls) for (const other of te.items) if (a.childUrls.includes(other.url)) other.hidden = true; // variant playlists of this master
    if (te.items.some((o) => o !== item && o.childUrls?.includes(url))) item.hidden = true;
    item.childUrls = a.childUrls;
  } catch (e) {
    // not a manifest after all (sniffed false positive) or unreachable
    te.items = te.items.filter((i) => i !== item);
    if (kind !== 'sniffed') console.debug('[streamgrab] analysis failed', url, e.message);
  } finally { await removeHeaderRule(rid); persist(); updateBadge(tabId); }
  if (item.state === 'ready') maybeAuto(tabId, item);
}
function maybeAuto(tabId, item) {
  if (!settings.auto || item.kind === 'file') return; // auto-mode only for HLS/DASH (progressive files are often ads/previews)
  setTimeout(async () => { // short delay so variant playlists can be hidden behind their master first
    await ready;
    if (item.hidden || item.problem || item.live || item.jobId) return;
    startDownload({ tabId, itemId: item.id, optionId: '0' });
  }, 2500);
}
function updateBadge(tabId) {
  const n = (S.media[tabId]?.items || []).filter((i) => !i.hidden && !i.problem).length;
  try { api.action.setBadgeText({ tabId, text: n ? String(n) : '' }); api.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' }); } catch { /* ignore */ }
}

api.webRequest.onHeadersReceived.addListener((d) => {
  if (d.tabId < 0) return;
  const c = classify(d); if (!c) return;
  addCandidate({ tabId: d.tabId, url: d.url, pageUrl: d.documentUrl || d.originUrl || d.initiator || '', ...c });
}, { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other', 'object', 'main_frame', 'sub_frame'] }, ['responseHeaders']);

api.tabs.onUpdated.addListener(async (tabId, info) => { // full navigation => forget old detections
  if (info.status === 'loading' && info.url) { await ready; delete S.media[tabId]; persist(); updateBadge(tabId); }
});
api.tabs.onRemoved.addListener(async (tabId) => { await ready; delete S.media[tabId]; persist(); });

// ---------- downloads ----------
const asciiName = (n) => n.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]+/g, '_');
/** downloads.download with a fallback to an ASCII-only filename (some Linux locales reject non-ASCII names). */
async function saveFile(opts) {
  try { return await api.downloads.download(opts); } catch (e) {
    if (!/filename/i.test(e.message)) throw e;
    return api.downloads.download({ ...opts, filename: asciiName(opts.filename) });
  }
}
const findItem = (itemId) => { for (const [tabId, te] of Object.entries(S.media)) { const it = te.items.find((i) => i.id === itemId); if (it) return { tabId: +tabId, item: it }; } return null; };
const setJob = (job, patch) => { Object.assign(job, patch); persist(); };
/** Creates a job and registers it; `extra` carries provenance used for the history entry. */
function makeJob(base, extra = {}) {
  const job = { id: `j${++S.seq}`, status: 'running', phase: 'download', pct: 0, bytes: 0, error: '', t: Date.now(), ...base, ...extra };
  S.jobs[job.id] = job; persist();
  return job;
}

async function ensureOffscreen() { // Chrome runs the engine in an offscreen document
  const ctx = await api.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx?.length) return;
  await api.offscreen.createDocument({ url: 'engine.html', reasons: ['BLOBS'], justification: 'Assemble downloaded video segments into one MP4 file' });
}
async function engineSend(msg) {
  if (__FIREFOX__) {
    const h = await import('./engine-host.js'); // Firefox: the engine lives in the background itself
    if (msg.type === 'start') h.startJob(msg.job, onEngineMsg);
    else if (msg.type === 'cancel') h.cancelJob(msg.jobId);
    else if (msg.type === 'revoke') h.revoke(msg.url);
    return;
  }
  await ensureOffscreen();
  await api.runtime.sendMessage({ target: 'engine', ...msg });
}

async function startDownload({ tabId, itemId, optionId = '0' }) {
  await ready;
  const f = findItem(itemId); if (!f) return { error: 'not-found' };
  const { item } = f;
  let title = item.title; try { title = (await api.tabs.get(tabId ?? f.tabId)).title || title; } catch { /* ignore */ }
  const opt = item.options.find((o) => o.id === String(optionId));
  const base = sanitizeFilename(title || new URL(item.url).hostname);
  const meta = { itemKind: item.kind, srcUrl: item.url, pageUrl: item.pageUrl, options: item.options, page: item.title };
  if (item.kind === 'file') {
    const ext = (/\.([a-z0-9]{2,4})(?:$|\?)/i.exec(new URL(item.url).pathname)?.[1]) || 'mp4';
    const job = makeJob({ tabId: f.tabId, itemId, title: base, quality: '', filename: `${base}.${ext}` }, meta);
    item.jobId = job.id; persist();
    job.rule = await addHeaderRule(item.pageUrl);
    try {
      const id = await saveFile({ url: item.url, filename: `${base}.${ext}`, saveAs: settings.saveAs, conflictAction: 'uniquify' });
      S.dl[id] = job.id; setJob(job, { status: 'saving', phase: 'save' });
    } catch (e) { setJob(job, { status: 'error', error: e.message }); removeHeaderRule(job.rule); }
    return { jobId: job.id };
  }
  const job = makeJob({ tabId: f.tabId, itemId, title: base, quality: opt?.label || '', filename: `${base}${opt?.height ? ` [${opt.height}p]` : ''}.mp4` }, { ...meta, optionId: String(optionId) });
  item.jobId = job.id; persist();
  job.rule = await addHeaderRule(item.pageUrl);
  engineSend({ type: 'start', job: { jobId: job.id, url: item.url, kind: item.kind, optionId: String(optionId), concurrency: settings.concurrency, maxBytes: settings.maxGB ? Math.round(settings.maxGB * 1024 ** 3) : 0 } }).catch((e) => onEngineMsg({ type: 'error', jobId: job.id, message: e.message }));
  return { jobId: job.id };
}

/** Re-download from the history: validates the manifest again (it may have changed), then runs a normal job. */
async function startHistDownload({ histId, optionId = '0' }) {
  await ready;
  const e = histFind(histId); if (!e) return { error: 'not-found' };
  if (e.kind === 'file') {
    const base = sanitizeFilename(e.title || new URL(e.srcUrl || 'x://v').hostname);
    const job = makeJob({ histId, title: base, quality: e.quality || '', filename: e.filename, itemKind: 'file', srcUrl: e.srcUrl, pageUrl: e.pageUrl });
    job.rule = await addHeaderRule(e.pageUrl);
    try {
      const id = await saveFile({ url: e.srcUrl, filename: e.filename, saveAs: settings.saveAs, conflictAction: 'uniquify' });
      S.dl[id] = job.id; setJob(job, { status: 'saving', phase: 'save' });
    } catch (err) { setJob(job, { status: 'error', error: String(err?.message || err) }); removeHeaderRule(job.rule); }
    return { jobId: job.id };
  }
  let options = [];
  try {
    const a = await analyzeManifest(e.srcUrl);
    if (a.problem) return { error: a.problem };
    options = a.options;
  } catch { return { error: 'manifest-unavailable' }; } // manifest no longer reachable?
  const want = String(optionId ?? e.optionId ?? '0'); // the caller's choice wins over the recorded one
  const optId = options.some((o) => o.id === want) ? want : '0';
  const opt = options.find((o) => o.id === optId);
  const base = sanitizeFilename(e.title || 'video');
  const job = makeJob({ histId, title: base, quality: opt?.label || '', filename: `${base}${opt?.height ? ` [${opt.height}p]` : ''}.mp4`, itemKind: e.kind, srcUrl: e.srcUrl, pageUrl: e.pageUrl, options, optionId: optId });
  job.rule = await addHeaderRule(e.pageUrl);
  engineSend({ type: 'start', job: { jobId: job.id, url: e.srcUrl, kind: e.kind, optionId: optId, concurrency: settings.concurrency, maxBytes: settings.maxGB ? Math.round(settings.maxGB * 1024 ** 3) : 0 } }).catch((err) => onEngineMsg({ type: 'error', jobId: job.id, message: String(err?.message || err) }));
  return { jobId: job.id };
}

async function onEngineMsg(m) {
  await ready;
  const job = S.jobs[m.jobId]; if (!job) return;
  if (m.type === 'progress') setJob(job, { phase: m.phase, pct: m.total ? Math.round((m.done / m.total) * 100) : 0, bytes: m.bytes, status: m.phase === 'mux' ? 'muxing' : 'running' });
  else if (m.type === 'done') {
    setJob(job, { status: 'saving', phase: 'save', pct: 100, size: m.size });
    try {
      const id = await saveFile({ url: m.blobUrl, filename: job.filename, saveAs: settings.saveAs, conflictAction: 'uniquify' });
      S.dl[id] = job.id; job.blobUrl = m.blobUrl; persist();
    } catch (e) { setJob(job, { status: 'error', error: e.message }); engineSend({ type: 'revoke', url: m.blobUrl }); removeHeaderRule(job.rule); }
  } else if (m.type === 'error') { setJob(job, { status: 'error', error: m.message }); removeHeaderRule(job.rule); }
  else if (m.type === 'cancelled') { setJob(job, { status: 'cancelled' }); removeHeaderRule(job.rule); }
}

/** Adds a completed download to the history (only when the browser confirmed the file). */
async function recordHistory(job, dlId) {
  if (!job.filename) return;
  try {
    const d = await api.downloads.search({ id: dlId }).catch(() => []);
    if (!d[0]) return;
    histUnshift({
      id: `h${++S.seq}`,
      fin: Date.now(),
      title: job.title, filename: String(job.filename).split('/').pop(), quality: job.quality || '',
      kind: job.itemKind || '', size: d[0].fileSize || job.size || 0,
      srcUrl: job.srcUrl || '', pageUrl: job.pageUrl || '', page: job.page || '',
      options: job.options || [], optionId: job.optionId || '',
      dlId,
    });
  } catch { /* history is best-effort */ }
}

api.downloads.onChanged.addListener(async (delta) => {
  await ready;
  const jobId = S.dl[delta.id]; const job = jobId && S.jobs[jobId]; if (!job) return;
  const st = delta.state?.current; if (!st || st === 'in_progress') return;
  if (st === 'complete') {
    setJob(job, { status: 'done' });
    recordHistory(job, delta.id);
  } else {
    setJob(job, { status: 'error', error: delta.error?.current || 'download interrupted' });
  }
  if (job.blobUrl) engineSend({ type: 'revoke', url: job.blobUrl });
  removeHeaderRule(job.rule); delete S.dl[delta.id]; persist();
});

// ---------- messaging ----------
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'engine') return false;
  (async () => {
    await ready;
    switch (msg?.type) {
      case 'sniffed': { const tabId = sender.tab?.id; if (tabId >= 0) addCandidate({ tabId, url: msg.url, kind: 'sniffed', pageUrl: msg.frameUrl || sender.url || '' }); return sendResponse({}); }
      case 'blob': { if (sender.tab) { tabEntry(sender.tab.id).blob = true; persist(); } return sendResponse({}); }
      case 'getState': {
        const te = S.media[msg.tabId] || { items: [], blob: false };
        const items = te.items.filter((i) => !i.hidden).map(({ childUrls, ...i }) => ({ ...i, job: i.jobId ? S.jobs[i.jobId] : null }));
        return sendResponse({ items, blob: te.blob, settings });
      }
      case 'download': return sendResponse(await startDownload(msg));
      case 'cancel': { const job = S.jobs[msg.jobId]; if (job) { engineSend({ type: 'cancel', jobId: job.id }); } return sendResponse({}); }
      case 'clear': { delete S.media[msg.tabId]; persist(); updateBadge(msg.tabId); return sendResponse({}); }
      case 'setSettings': { Object.assign(settings, msg.settings); await api.storage.local.set({ settings }); return sendResponse(settings); }
      case 'getHistory': {
        const stats = history.reduce((a, e) => { a.count++; a.bytes += e.size || 0; return a; }, { count: 0, bytes: 0 });
        const jobs = Object.values(S.jobs).filter((j) => j.histId);
        return sendResponse({ items: history, stats, jobs });
      }
      case 'histDownload': return sendResponse(await startHistDownload(msg));
      case 'histRemove': { const h = histFind(msg.histId); if (h) { history = history.filter((x) => x !== h); persistHistory(); } return sendResponse({}); }
      case 'histClear': { history = []; persistHistory(); return sendResponse({}); }
      case 'openFile': {
        try { await api.downloads.open(+msg.dlId); } catch { try { await api.downloads.show(+msg.dlId); } catch { try { await api.downloads.showDefaultFolder(); } catch { /* nothing more we can do */ } } }
        return sendResponse({});
      }
      case 'showFile': { try { await api.downloads.show(+msg.dlId); } catch { try { await api.downloads.showDefaultFolder(); } catch { /* ignore */ } } return sendResponse({}); }
      case 'rescan': return sendResponse({});
      default:
        if (msg?.target === 'bg') { await onEngineMsg(msg); }
        return sendResponse({});
    }
  })();
  return true;
});
