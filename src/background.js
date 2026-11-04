// StreamGrab background: detects media requests, analyses manifests, runs downloads.
import { analyzeManifest } from './core/analyze.js';
import { formatName, DEFAULT_TEMPLATE } from './core/naming.js';
import { makeT } from './i18n.js';

const api = globalThis.browser ?? globalThis.chrome;
/* global __FIREFOX__ */

let S = { media: {}, jobs: {}, seq: 0, dl: {}, queue: [] };
const DEFAULTS = { auto: false, concurrency: 6, maxParallel: 2, saveAs: false, maxGB: 0, notify: true, history: true, theme: 'auto', lang: 'auto', template: DEFAULT_TEMPLATE }; // maxGB 0 = no size limit
const settings = { ...DEFAULTS };
let history = [];
const ready = (async () => {
  try { const s = await api.storage.session.get('state'); if (s.state) S = { ...S, ...s.state }; } catch { /* session storage unavailable */ }
  try { const l = await api.storage.local.get(['settings', 'history']); Object.assign(settings, l.settings || {}); history = l.history || []; } catch { /* ignore */ }
})();
let persistTimer;
const persist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => api.storage.session.set({ state: S }).catch(() => {}), 150); };

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
const T = () => makeT(settings.lang);
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
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function ensureOffscreen() {
  const ctx = await api.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx?.length) return;
  await api.offscreen.createDocument({ url: 'engine.html', reasons: ['BLOBS'], justification: 'Assemble downloaded video segments into one MP4 file' });
}
async function engineSend(msg) {
  if (__FIREFOX__) { const h = await import('./engine-host.js'); if (msg.type === 'start') h.startJob(msg.job, onEngineMsg); else if (msg.type === 'cancel') h.cancelJob(msg.jobId); else if (msg.type === 'revoke') h.revoke(msg.url); return; }
  await ensureOffscreen();
  await api.runtime.sendMessage({ target: 'engine', ...msg });
}

// ----- history -----
const saveHistory = () => api.storage.local.set({ history }).catch(() => {});
function addHistory(job) {
  if (!settings.history || job.status === 'cancelled') return;
  history.unshift({ id: `${job.id}-${job.t}`, title: job.title, site: job.site, pageUrl: job.pageUrl, url: job.url, kind: job.kind, quality: job.quality, mode: job.mode, ext: job.ext, size: job.size || 0, duration: job.duration || 0, date: Date.now(), status: job.status, error: job.error || '', downloadId: job.downloadId ?? null, filename: job.filename, thumb: job.thumb || '' });
  history = history.slice(0, 500); saveHistory();
}

// ----- notifications -----
function notify(job) {
  if (!settings.notify || !api.notifications || job.status === 'cancelled') return;
  const t = T();
  try {
    api.notifications.create(`sg-${job.id}`, { type: 'basic', iconUrl: api.runtime.getURL('icons/icon128.png'), title: t(job.status === 'done' ? 'notifDone' : 'notifError'), message: job.status === 'done' ? job.filename : `${job.title}: ${job.error.startsWith('SIZE_LIMIT') ? t('limitHit') : job.error}` });
  } catch { /* notifications unavailable */ }
}
api.notifications?.onClicked.addListener(async (id) => {
  await ready; const job = S.jobs[id.replace(/^sg-/, '')];
  if (job?.downloadId != null) try { api.downloads.show(job.downloadId); } catch { /* ignore */ }
});

// ----- queue -----
const active = () => Object.values(S.jobs).filter((j) => j.status === 'running' || j.status === 'muxing').length;
function pump() {
  while (S.queue.length && active() < settings.maxParallel) {
    const job = S.queue.shift(); if (S.jobs[job]) launch(S.jobs[job]);
  }
  persist();
}
function finishJob(job, status, error = '') {
  if (job.finished) return;
  job.finished = true; setJob(job, { status, error, endedAt: Date.now() });
  removeHeaderRule(job.rule); addHistory(job); notify(job); pump();
}

async function startDownload({ tabId, itemId, optionId = '0', mode = 'both', thumb = '' }) {
  await ready;
  const f = findItem(itemId); if (!f) return { error: 'not-found' };
  const { item } = f;
  if (item.jobId && ['queued', 'running', 'muxing', 'saving'].includes(S.jobs[item.jobId]?.status)) return { jobId: item.jobId };
  let title = item.title; try { title = (await api.tabs.get(tabId ?? f.tabId)).title || title; } catch { /* ignore */ }
  const opt = item.options.find((o) => o.id === String(optionId));
  const audio = mode === 'audio' && item.kind !== 'file';
  let ext = item.kind === 'file' ? ((/\.([a-z0-9]{2,4})(?:$|\?)/i.exec(new URL(item.url).pathname)?.[1]) || 'mp4') : audio ? 'm4a' : 'mp4';
  const quality = audio ? 'audio' : opt?.height ? `${opt.height}p` : '';
  const filename = formatName(settings.template, { title: title || hostOf(item.url), quality, site: hostOf(item.pageUrl || item.url), kind: item.kind }, ext);
  const job = { id: `j${++S.seq}`, itemId, tabId: f.tabId, title: filename.replace(/\.[^.]+$/, ''), filename, ext, mode: audio ? 'audio' : 'both', status: 'queued', phase: 'download', pct: 0, bytes: 0, speed: 0, eta: null, quality: audio ? 'audio' : (opt?.height ? `${opt.height}p` : ''), error: '', t: Date.now(), url: item.url, kind: item.kind, pageUrl: item.pageUrl, site: hostOf(item.pageUrl || item.url), thumb, duration: item.duration || 0, optionId: String(optionId) };
  S.jobs[job.id] = job; item.jobId = job.id; S.queue.push(job.id); persist();
  pump();
  return { jobId: job.id };
}

async function launch(job) {
  Object.assign(job, { status: 'running', startedAt: Date.now() }); persist();
  job.rule = await addHeaderRule(job.pageUrl);
  if (job.kind === 'file') {
    try {
      const id = await saveFile({ url: job.url, filename: job.filename, saveAs: settings.saveAs, conflictAction: 'uniquify' });
      S.dl[id] = job.id; job.downloadId = id; setJob(job, { status: 'saving', phase: 'save' });
    } catch (e) { finishJob(job, 'error', e.message); }
    return;
  }
  engineSend({ type: 'start', job: { jobId: job.id, url: job.url, kind: job.kind, optionId: job.optionId, mode: job.mode, concurrency: settings.concurrency, maxBytes: settings.maxGB ? Math.round(settings.maxGB * 1024 ** 3) : 0 } })
    .catch((e) => onEngineMsg({ type: 'error', jobId: job.id, message: e.message }));
}

async function onEngineMsg(m) {
  await ready;
  const job = S.jobs[m.jobId]; if (!job) return;
  if (m.type === 'progress') {
    const el = Math.max(0.001, (Date.now() - job.startedAt) / 1000);
    setJob(job, { phase: m.phase, pct: m.total ? Math.round((m.done / m.total) * 100) : 0, bytes: m.bytes, speed: m.bytes / el, eta: m.done > 0 && m.phase === 'download' ? Math.round(el * (m.total - m.done) / m.done) : null, status: m.phase === 'mux' ? 'muxing' : 'running' });
  } else if (m.type === 'done') {
    setJob(job, { status: 'saving', phase: 'save', pct: 100, size: m.size, eta: null, speed: 0 }); pump();
    try {
      const id = await saveFile({ url: m.blobUrl, filename: job.filename, saveAs: settings.saveAs, conflictAction: 'uniquify' });
      S.dl[id] = job.id; job.blobUrl = m.blobUrl; job.downloadId = id; persist();
    } catch (e) { engineSend({ type: 'revoke', url: m.blobUrl }); finishJob(job, 'error', e.message); }
  } else if (m.type === 'error') finishJob(job, 'error', m.message === 'NO_AUDIO' ? T()('noAudio') : m.message);
  else if (m.type === 'cancelled') finishJob(job, 'cancelled');
}

api.downloads.onChanged.addListener(async (delta) => {
  await ready;
  const jobId = S.dl[delta.id]; const job = jobId && S.jobs[jobId]; if (!job) return;
  const st = delta.state?.current; if (!st || st === 'in_progress') return;
  if (job.blobUrl) engineSend({ type: 'revoke', url: job.blobUrl });
  delete S.dl[delta.id];
  if (st === 'complete') {
    try { const [d] = await api.downloads.search({ id: delta.id }); if (d && !job.size) job.size = d.fileSize || d.totalBytes || 0; } catch { /* ignore */ }
    finishJob(job, 'done');
  } else finishJob(job, 'error', delta.error?.current || 'download interrupted');
});

// ---------- messaging ----------
async function historyView() {
  const list = history.slice(0, 300);
  await Promise.all(list.slice(0, 80).map(async (h) => {
    h.exists = true;
    if (h.status === 'done' && h.downloadId != null) { try { const [d] = await api.downloads.search({ id: h.downloadId }); h.exists = !!d && d.exists !== false; } catch { h.exists = false; } }
  }));
  return list;
}
const SETTING_KEYS = Object.keys(DEFAULTS);
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'engine') return false;
  (async () => {
    await ready;
    switch (msg?.type) {
      case 'sniffed': { const tabId = sender.tab?.id; if (tabId >= 0) addCandidate({ tabId, url: msg.url, kind: 'sniffed', pageUrl: msg.frameUrl || sender.url || '' }); return sendResponse({}); }
      case 'blob': { if (sender.tab) { tabEntry(sender.tab.id).blob = true; persist(); } return sendResponse({}); }
      case 'getState': {
        const te = S.media[msg.tabId] || { items: [], blob: false };
        const items = te.items.filter((i) => !i.hidden).map(({ childUrls, ...i }) => ({ ...i, job: i.jobId ? S.jobs[i.jobId] : null })).reverse();
        const queue = Object.values(S.jobs).filter((j) => ['queued', 'running', 'muxing', 'saving'].includes(j.status)).length;
        return sendResponse({ items, blob: te.blob, settings, activeJobs: queue, historyCount: history.length });
      }
      case 'download': return sendResponse(await startDownload(msg));
      case 'downloadAll': {
        const te = S.media[msg.tabId]; let n = 0;
        for (const it of te?.items || []) if (!it.hidden && !it.problem && !it.live && it.state === 'ready' && !(it.jobId && ['queued', 'running', 'muxing', 'saving', 'done'].includes(S.jobs[it.jobId]?.status))) { await startDownload({ tabId: msg.tabId, itemId: it.id, optionId: '0', thumb: msg.thumb }); n++; }
        return sendResponse({ started: n });
      }
      case 'cancel': {
        const job = S.jobs[msg.jobId]; if (!job) return sendResponse({});
        if (job.status === 'queued') { S.queue = S.queue.filter((x) => x !== job.id); finishJob(job, 'cancelled'); } else engineSend({ type: 'cancel', jobId: job.id });
        return sendResponse({});
      }
      case 'clear': { delete S.media[msg.tabId]; persist(); updateBadge(msg.tabId); return sendResponse({}); }
      case 'setSettings': {
        for (const k of SETTING_KEYS) if (k in (msg.settings || {})) settings[k] = msg.settings[k];
        settings.maxParallel = Math.min(4, Math.max(1, +settings.maxParallel || 2)); settings.concurrency = Math.min(16, Math.max(1, +settings.concurrency || 6));
        if (!String(settings.template || '').trim()) settings.template = DEFAULT_TEMPLATE;
        await api.storage.local.set({ settings }); pump(); return sendResponse(settings);
      }
      case 'getHistory': return sendResponse({ history: await historyView() });
      case 'historyDelete': { history = history.filter((h) => h.id !== msg.id); saveHistory(); return sendResponse({}); }
      case 'historyClear': { history = []; saveHistory(); return sendResponse({}); }
      case 'historyShow': { try { api.downloads.show(msg.downloadId); } catch { /* ignore */ } return sendResponse({}); }
      case 'openUrl': { if (/^https?:/i.test(msg.url || '')) api.tabs.create({ url: msg.url }); return sendResponse({}); }
      default:
        if (msg?.target === 'bg') { await onEngineMsg(msg); }
        return sendResponse({});
    }
  })();
  return true;
});
