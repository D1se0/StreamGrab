import { makeT } from './i18n.js';
import { formatName, DEFAULT_TEMPLATE } from './core/naming.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = (s) => document.querySelector(s);
const send = (m) => api.runtime.sendMessage(m);
const q = new URLSearchParams(location.search);

// ---------- DOM + icon helpers (no innerHTML) ----------
const ICONS = {
  download: 'M12 3v12m0 0l-5-5m5 5l5-5M4 20h16', copy: 'M9 9h11v11H9zM5 15V5h10', term: 'M4 5h16v14H4zM8 10l3 2-3 2M13 14h3',
  folder: 'M3 6h6l2 2h10v11H3z', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18', play: 'M8 5l11 7-11 7z',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  cog: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-4l-.5 2.5-1.5 1L7 7l-2 4 2 1v2l-2 1 2 4 2-.5 1.5 1L11 20h4l.5-2.5 1.5-1 2 .5 2-4-2-1z',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5', ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', retry: 'M4 4v6h6M20 20v-6h-6M5.5 15A8 8 0 0 0 20 12M18.5 9A8 8 0 0 0 4 12',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z', monitor: 'M3 5h18v11H3zM8 20h8M12 16v4', bell: 'M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4',
  tag: 'M3 12V3h9l9 9-9 9zM8 8h.01', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', hdd: 'M3 14h18v6H3zM3 14l3-9h12l3 9M7 17h.01', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  list: 'M4 6h16M4 12h16M4 18h10', save: 'M5 4h12l3 3v13H5zM8 4v5h8V4M8 20v-6h8v6',
};
const icon = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name]); s.append(p); return s; };
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
};
const btn = (cls, ic, label, onclick, title) => h('button', { class: cls, onclick, title: title || label || '', 'aria-label': title || label || ic }, ic ? icon(ic) : null, label || null);
const seg = (opts, value, onchange) => h('div', { class: 'seg', role: 'group' }, opts.map(([v, label, ic]) => h('button', { class: String(value) === String(v) ? 'on' : '', 'aria-pressed': String(value) === String(v), onclick: () => onchange(v) }, ic ? icon(ic) : null, label)));
const selectBox = (opts, value, onchange, extra = {}) => h('div', { class: 'select' }, h('select', { ...extra, onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(value) === String(v) }, l))));

// ---------- state ----------
let t = makeT('auto'), cfg = {}, tabId, tab = q.get('view') || 'detected', lastSig = '', thumb = '', histFilter = '';
const selected = {}, modes = {}, counts = { d: 0, h: 0 }, seenCards = new Set(); // seenCards: only brand-new cards animate in (re-renders must not flicker)
let activeJobs = 0;

const fmtBytes = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDur = (s) => { s = Math.round(s); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`; };
const dayLabel = (ts) => { const d = new Date(ts), n = new Date(); const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); const diff = Math.round((day(n) - day(d)) / 864e5); return diff === 0 ? t('today') : diff === 1 ? t('yesterday') : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_m, k) => v[k]);
let toastTimer;
const toast = (msg) => { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 1400); };
const copy = async (text) => { try { await navigator.clipboard.writeText(text); } catch { const ta = h('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); } toast(`${t('copied')}`); };
const ffmpegCmd = (i) => `ffmpeg ${i.pageUrl ? `-referer "${i.pageUrl}" ` : ''}-i "${i.url}" -c copy "video.mp4"`;
const BUSY = ['queued', 'running', 'muxing', 'saving'];
const errText = (e) => (String(e).startsWith('SIZE_LIMIT') ? t('limitHit') : `${t('error')}: ${e}`);

function applyTheme() { document.documentElement.dataset.theme = cfg.theme && cfg.theme !== 'auto' ? cfg.theme : ''; }
function drawChrome() {
  const act = $('#active'); act.hidden = !activeJobs; act.textContent = activeJobs ? String(activeJobs) : ''; act.title = t('activeDl');
  $('#tabs').replaceChildren(...[['detected', 'film', 'tabDetected'], ['history', 'clock', 'tabHistory'], ['settings', 'cog', 'tabSettings']].map(([id, ic, k]) =>
    h('button', { class: `tab${tab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': tab === id, 'data-tab': id, onclick: () => { tab = id; show(); } }, icon(ic), t(k), id === 'detected' && counts.d ? h('span', { class: 'n' }, counts.d) : id === 'history' && counts.h ? h('span', { class: 'n' }, counts.h) : null)));
}
function show() { for (const id of ['detected', 'history', 'settings']) $(`#tab-${id}`).hidden = id !== tab; drawChrome(); lastSig = ''; if (tab === 'history') renderHistory(); else if (tab === 'settings') renderSettings(); else refresh(); }

// ---------- DETECTED ----------
async function refresh() {
  const st = await send({ type: 'getState', tabId }); if (!st) return;
  cfg = st.settings; counts.d = st.items.filter((i) => !i.problem).length; counts.h = st.historyCount; activeJobs = st.activeJobs || 0;
  const sig = JSON.stringify([tab, cfg.lang, st.items.map((i) => [i.id, i.state, i.problem, i.options.length, i.job?.status, i.job?.id]), st.blob, activeJobs]);
  if (sig !== lastSig) { lastSig = sig; t = makeT(cfg.lang); applyTheme(); drawChrome(); if (tab === 'detected') renderDetected(st); }
  if (tab === 'detected') for (const i of st.items) updateProgress(i);
}
function renderDetected(st) {
  const ready = st.items.filter((i) => i.state === 'ready' && !i.problem && !i.live && !(i.job && [...BUSY, 'done'].includes(i.job.status)));
  const n = st.items.length;
  $('#dToolbar').replaceChildren(...(n ? [h('span', { class: 'cnt' }, n === 1 ? t('nVideos1') : fill(t('nVideosN'), { n })), h('div', { class: 'row' },
    ready.length > 1 ? btn('primary sm', 'download', `${t('downloadAll')} (${ready.length})`, () => send({ type: 'downloadAll', tabId, thumb }).then(refresh)) : null,
    btn('ghost sm', 'trash', t('clear'), async () => { await send({ type: 'clear', tabId }); lastSig = ''; refresh(); }))] : []));
  $('#empty').hidden = n > 0;
  if (!n) $('#empty').replaceChildren(h('div', { class: 'art' }, icon('download')), h('b', {}, t('stepsTitle')), st.blob ? h('div', { class: 'box warn', style: 'margin-top:8px;text-align:left' }, icon('alert'), h('span', {}, t('blob'))) : null,
    h('ol', { class: 'steps' }, [1, 2, 3].map((k) => h('li', {}, h('span', { class: 'num' }, k), h('span', {}, t(`step${k}`))))));
  $('#list').replaceChildren(...st.items.map(card));
}
function card(i) {
  const u = new URL(i.url), job = i.job, busy = job && BUSY.includes(job.status);
  const mode = modes[i.id] || 'both';
  const opt = i.options.find((o) => o.id === (selected[i.id] ?? '0')) || i.options[0];
  const est = i.kind === 'file' ? i.size : opt?.bandwidth && i.duration ? (opt.bandwidth * i.duration) / 8 : 0;
  const kind = { hls: 'HLS', dash: 'DASH' }[i.kind] || (/\.(\w{2,4})(?:$|\?)/.exec(u.pathname)?.[1] || 'FILE').toUpperCase();
  const sel = i.options.length > 1 && mode === 'both' ? selectBox(i.options.map((o, k) => [o.id, k === 0 ? `★ ${o.label}` : o.label]), selected[i.id] ?? '0', (v) => { selected[i.id] = v; lastSig = ''; refresh(); }, { 'data-opt': true, 'aria-label': 'Quality' }) : null;
  const go = () => send({ type: 'download', tabId, itemId: i.id, optionId: sel?.querySelector('select').value ?? selected[i.id] ?? '0', mode, thumb }).then(refresh);
  const parts = [];
  parts.push(h('div', { class: 'top' },
    h('div', { class: 'thumb' }, icon('play'), thumb ? h('img', { src: thumb, alt: '', onerror: (e) => e.target.remove() }) : null, h('span', { class: 'tk' }, kind), i.duration ? h('span', { class: 'td' }, fmtDur(i.duration)) : null),
    h('div', { class: 'info' }, h('div', { class: 'title', title: i.title }, i.title || u.hostname), h('div', { class: 'sub', title: i.url }, `${u.host}${u.pathname}`),
      h('div', { class: 'chips' }, opt?.height ? h('span', { class: 'chip g' }, `${opt.height}p`) : null, est && mode === 'both' ? h('span', { class: 'chip' }, `~${fmtBytes(est)}`) : null, i.live ? h('span', { class: 'chip w' }, 'LIVE') : null)),
    h('div', { class: 'acts' }, btn('ic', 'link', '', () => copy(i.url), t('copyUrl')), btn('ic', 'term', '', () => copy(ffmpegCmd(i)), t('copyFfmpeg')))));
  if (i.problem) parts.push(h('div', { class: 'box err' }, icon('alert'), h('span', {}, t(i.problem))));
  else if (i.state === 'analyzing') parts.push(h('div', { class: 'skel' }, h('i', { style: 'width:70%' }), h('i', { style: 'width:45%' })));
  else if (busy) parts.push(h('div', { class: 'prog' },
    h('div', { class: 'prow' }, h('span', { class: 'pst', 'data-pst': true }), h('span', { class: 'ppct', 'data-pct': true }), btn('ic', 'x', '', () => send({ type: 'cancel', jobId: job.id }), t('cancel'))),
    h('div', { class: 'bar', 'data-bar': true }, h('i')), h('div', { class: 'pmeta', 'data-status': true })));
  else {
    if (i.live) parts.push(h('div', { class: 'box warn' }, icon('alert'), h('span', {}, t('live'))));
    if (job?.status === 'done') parts.push(h('div', { class: 'box ok' }, icon('check'), h('span', {}, `${t('saved')}${job.size ? ` · ${fmtBytes(job.size)}` : ''}`), job.downloadId != null ? btn('sm', 'folder', t('show'), () => send({ type: 'historyShow', downloadId: job.downloadId })) : null));
    if (job?.status === 'error') parts.push(h('div', { class: 'box err', 'data-status': true }, icon('alert'), h('span', { title: job.error }, errText(job.error)), btn('sm', 'retry', t('retry'), go)));
    if (job?.status === 'cancelled') parts.push(h('div', { class: 'box info' }, icon('x'), h('span', {}, t('cancelled'))));
    const segEl = i.kind !== 'file' && i.options.length ? seg([['both', t('video')], ['audio', t('audio')]], mode, (m) => { modes[i.id] = m; lastSig = ''; refresh(); }) : null;
    if (segEl || sel) parts.push(h('div', { class: 'controls' }, segEl, sel));
    parts.push(btn('primary dl', 'download', job?.status === 'done' ? t('again') : t('download'), go));
  }
  const isNew = !seenCards.has(i.id); seenCards.add(i.id);
  return h('div', { class: `card${isNew ? ' enter' : ''}`, 'data-id': i.id }, ...parts);
}
function updateProgress(i) {
  const el = document.querySelector(`.card[data-id="${i.id}"]`), j = i.job; if (!el || !j || !el.querySelector('[data-bar]')) return;
  const bar = el.querySelector('[data-bar]'); bar.className = `bar${j.status === 'queued' ? ' q' : ''}${j.status === 'muxing' || j.status === 'saving' ? ' m' : ''}`;
  bar.firstChild.style.width = `${j.pct}%`;
  el.querySelector('[data-pst]').textContent = t(j.status);
  el.querySelector('[data-pct]').textContent = j.status === 'queued' ? '' : `${j.pct}%`;
  el.querySelector('[data-status]').textContent = j.status === 'running' ? [fmtBytes(j.bytes || 0), j.speed ? `${fmtBytes(j.speed)}/s` : '', j.eta != null ? `${t('eta')} ${fmtDur(j.eta)}` : ''].filter(Boolean).join(' · ') : '';
}

// ---------- HISTORY ----------
async function renderHistory() {
  const box = $('#searchBox');
  if (!box.firstChild) box.replaceChildren(icon('search'), h('input', { type: 'search', 'aria-label': t('histSearch'), placeholder: t('histSearch'), oninput: (e) => { histFilter = e.target.value.toLowerCase(); renderHistory(); } }));
  box.querySelector('input').placeholder = t('histSearch');
  const { history } = await send({ type: 'getHistory' });
  counts.h = history.length; drawChrome();
  const list = history.filter((x) => !histFilter || `${x.title} ${x.site} ${x.quality} ${x.filename}`.toLowerCase().includes(histFilter));
  $('#hEmpty').hidden = list.length > 0;
  if (!list.length) $('#hEmpty').replaceChildren(h('div', { class: 'art' }, icon('clock')), h('b', {}, t('histEmpty')));
  const totalSize = history.filter((x) => x.status === 'done').reduce((a, x) => a + (x.size || 0), 0);
  $('#hSummary').replaceChildren(...(history.length ? [fill(t('histSummary'), { n: history.length, size: fmtBytes(totalSize || 0) })] : []));
  const out = []; let last = '';
  for (const x of list) {
    const d = dayLabel(x.date); if (d !== last) { out.push(h('div', { class: 'day' }, d)); last = d; }
    const gone = x.status === 'done' && x.exists === false, err = x.status === 'error';
    out.push(h('div', { class: `h${gone ? ' gone' : ''}`, title: gone ? t('fileGone') : x.title },
      h('div', { class: `tile${err ? ' error' : x.mode === 'audio' ? ' audio' : ''}` }, icon(x.mode === 'audio' ? 'music' : 'film'), x.thumb && !err && x.mode !== 'audio' ? h('img', { src: x.thumb, alt: '', onerror: (e) => e.target.remove() }) : null, h('span', { class: `bdg${err ? ' error' : ''}` }, icon(err ? 'x' : 'check'))),
      h('div', { class: 'info' }, h('div', { class: 'title' }, x.filename || x.title),
        h('div', { class: 'sub' }, ...[x.site, x.quality, x.size ? fmtBytes(x.size) : '', x.duration ? fmtDur(x.duration) : ''].filter(Boolean).map((v) => h('span', {}, v))),
        err ? h('div', { class: 'errtxt' }, errText(x.error)) : null),
      h('div', { class: 'when' }, new Date(x.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      h('div', { class: 'hacts' },
        x.status === 'done' && !gone && x.downloadId != null ? btn('ic', 'folder', '', () => send({ type: 'historyShow', downloadId: x.downloadId }), t('openFolder')) : null,
        x.pageUrl ? btn('ic', 'ext', '', () => send({ type: 'openUrl', url: x.pageUrl }), t('openPage')) : null,
        btn('ic', 'link', '', () => copy(x.url), t('copyUrl')),
        btn('ic danger', 'trash', '', async () => { await send({ type: 'historyDelete', id: x.id }); renderHistory(); }, t('remove')))));
  }
  $('#hlist').replaceChildren(...out);
  $('#hFooter').replaceChildren(...(history.length ? [btn('sm', 'save', t('histExport'), () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' })), download: 'streamgrab-history.json' }); a.click(); }), btn('sm danger', 'trash', t('histClear'), async () => { if (confirm(t('histClearConfirm'))) { await send({ type: 'historyClear' }); renderHistory(); } })] : []));
}

// ---------- SETTINGS ----------
async function setCfg(patch) { cfg = await send({ type: 'setSettings', settings: patch }); t = makeT(cfg.lang); applyTheme(); drawChrome(); }
function renderSettings() {
  const toggle = (key) => h('label', { class: 'sw' }, h('input', { type: 'checkbox', checked: !!cfg[key], 'aria-label': key, onchange: (e) => setCfg({ [key]: e.target.checked }) }), h('i'));
  const row = (ic, title, desc, ctl) => h('div', { class: 's' }, h('div', { class: 'lead' }, icon(ic)), h('div', { class: 'l' }, h('b', {}, title), desc ? h('span', {}, desc) : null), ctl);
  const rerender = async (patch) => { await setCfg(patch); renderSettings(); };
  const preview = h('div', { class: 'prev' });
  const upd = (v) => { preview.replaceChildren(`${t('preview')}: `, h('code', {}, formatName(v || DEFAULT_TEMPLATE, { title: 'My video', quality: '1080p', site: 'example.com' }, 'mp4'))); };
  upd(cfg.template);
  const input = h('input', { type: 'text', value: cfg.template || DEFAULT_TEMPLATE, 'aria-label': t('sTemplate'), oninput: (e) => upd(e.target.value), onchange: (e) => setCfg({ template: e.target.value }) });
  const chips = h('div', { class: 'tpl' }, ['{title}', '{quality}', '{site}', '{date}', '{time}'].map((p) => h('button', { title: t('insert'), onclick: () => { input.value += p; upd(input.value); setCfg({ template: input.value }); } }, p)));
  const manifest = api.runtime.getManifest();
  const repo = manifest.homepage_url && !manifest.homepage_url.includes('YOUR_USER') ? manifest.homepage_url : '';
  $('#tab-settings').replaceChildren(
    h('div', { class: 'group' }, t('secDownloads')),
    h('div', { class: 'set' },
      row('bolt', t('sAuto'), t('sAutoD'), toggle('auto')),
      row('layers', t('sParallel'), t('sParallelD'), seg([1, 2, 3, 4].map((n) => [n, String(n)]), cfg.maxParallel, (v) => rerender({ maxParallel: +v }))),
      row('list', t('sSegments'), t('sSegmentsD'), selectBox([2, 4, 6, 8, 12, 16].map((n) => [n, n]), cfg.concurrency, (v) => setCfg({ concurrency: +v }))),
      row('hdd', t('sLimit'), '', selectBox([[0, t('noLimit')], [1, '1 GB'], [2, '2 GB'], [4, '4 GB'], [8, '8 GB'], [16, '16 GB'], [32, '32 GB']], cfg.maxGB, (v) => setCfg({ maxGB: +v })))),
    h('div', { class: 'group' }, t('secFiles')),
    h('div', { class: 'set' },
      row('folder', t('sAsk'), '', toggle('saveAs')), row('bell', t('sNotify'), t('sNotifyD'), toggle('notify')), row('clock', t('sHistory'), '', toggle('history')),
      h('div', { class: 's col' }, h('div', { class: 'lead' }, icon('tag')), h('div', { class: 'l' }, h('b', {}, t('sTemplate')), h('span', {}, t('sTemplateD'))), h('div', { class: 'full' }, input, chips, preview))),
    h('div', { class: 'group' }, t('secLook')),
    h('div', { class: 'set' },
      row('sun', t('sTheme'), '', seg([['auto', t('themeAuto'), 'monitor'], ['light', t('themeLight'), 'sun'], ['dark', t('themeDark'), 'moon']], cfg.theme || 'auto', (v) => rerender({ theme: v }))),
      row('globe', t('sLang'), '', seg([['auto', t('langAuto')], ['es', 'ES'], ['en', 'EN']], cfg.lang || 'auto', (v) => rerender({ lang: v })))),
    h('div', { class: 'about' }, h('img', { src: 'icons/icon48.png', alt: '' }), h('div', { class: 'l' }, h('b', {}, `StreamGrab v${manifest.version}`), h('span', {}, t('about'))), repo ? btn('sm', 'ext', t('github'), () => send({ type: 'openUrl', url: repo })) : null));
}

// ---------- boot ----------
async function pageInfo() { try { const r = await api.tabs.sendMessage(tabId, { type: 'pageInfo' }, { frameId: 0 }); thumb = r?.thumb || ''; } catch { thumb = ''; } }
(async () => {
  const [active] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = +q.get('tab') || active?.id;
  let tabInfo = active; if (q.get('tab')) { try { tabInfo = await api.tabs.get(tabId); } catch { /* ignore */ } }
  try { const u = new URL(tabInfo.url); $('#site').replaceChildren(...(tabInfo.favIconUrl ? [h('img', { src: tabInfo.favIconUrl, alt: '', onerror: (e) => e.target.remove() })] : []), h('span', {}, u.hostname)); } catch { $('#site').hidden = true; }
  const st = await send({ type: 'getState', tabId }); cfg = st.settings; t = makeT(cfg.lang); applyTheme();
  await pageInfo(); show();
  setInterval(() => { if (tab === 'detected') refresh(); }, 600);
})();
