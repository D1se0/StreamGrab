const api = globalThis.browser ?? globalThis.chrome;
const L = {
  en: {
    clear: 'Clear', auto: 'Auto-download best quality when detected', download: 'Download', cancel: 'Cancel', none: 'No videos detected on this page yet.\nPlay the video or reload the page (F5) – the extension can only see requests made while it is active.', blob: 'This page plays a blob: video. Reload the page so the extension can capture its stream manifest.', analyzing: 'Analysing…', running: 'Downloading', muxing: 'Building MP4…', saving: 'Saving…', done: 'Saved ✓ (check your downloads)', error: 'Error', cancelled: 'Cancelled', drm: 'DRM-protected (Widevine/FairPlay): cannot be downloaded.', webm: 'WebM/VP9 DASH is not supported yet.', empty: 'Empty or unsupported stream.', live: 'Live stream – downloading what is available now.', file: 'Direct file', limit: 'Max download size', nolimit: 'No limit', limitHit: 'Stopped: size limit reached. Raise or remove the limit in the footer and retry.',
    videos: 'Videos', thisPage: 'Videos on this page', history: 'History', searchPh: 'Search title, site or file…', noHist: 'No downloads yet — everything you grab from any site will be saved here.', hClear: 'Clear all', sure: 'Sure?', hRedl: 'Download again', hOpen: 'Open video', hFolder: 'Show in downloads folder', hCopy: 'Copy stream URL', copyCard: 'Copy stream URL', copied: 'Copied', hDel: 'Remove from history', manifestGone: 'The source is no longer available; it could not be analysed again.', justNow: 'just now', minAgo: (n) => `${n} min ago`, hourAgo: (n) => `${n} h ago`, yesterday: 'yesterday', downloads: (n) => `${n} download${n === 1 ? '' : 's'}`,
  },
  es: {
    clear: 'Limpiar', auto: 'Descargar automáticamente la mejor calidad al detectar', download: 'Descargar', cancel: 'Cancelar', none: 'Aún no se ha detectado ningún vídeo en esta página.\nReproduce el vídeo o recarga la página (F5): la extensión solo ve las peticiones mientras está activa.', blob: 'Esta página reproduce un vídeo blob:. Recarga la página para que la extensión capture el manifiesto del stream.', analyzing: 'Analizando…', running: 'Descargando', muxing: 'Generando MP4…', saving: 'Guardando…', done: 'Guardado ✓ (mira tus descargas)', error: 'Error', cancelled: 'Cancelado', drm: 'Protegido con DRM (Widevine/FairPlay): no se puede descargar.', webm: 'DASH WebM/VP9 aún no soportado.', empty: 'Stream vacío o no soportado.', live: 'Directo: se descarga lo disponible ahora mismo.', file: 'Archivo directo', limit: 'Tamaño máximo de descarga', nolimit: 'Sin límite', limitHit: 'Detenido: se alcanzó el límite de tamaño. Súbelo o quítalo en el pie del popup y reintenta.',
    videos: 'Vídeos', thisPage: 'Vídeos en esta página', history: 'Historial', searchPh: 'Buscar por título, sitio o fichero…', noHist: 'Aún no hay descargas: todo lo que grabes de cualquier sitio aparecerá aquí.', hClear: 'Vaciar', sure: '¿Seguro?', hRedl: 'Volver a descargar', hOpen: 'Abrir el vídeo', hFolder: 'Mostrar en la carpeta de descargas', hCopy: 'Copiar URL del stream', copyCard: 'Copiar URL del stream', copied: 'Copiado', hDel: 'Quitar del historial', manifestGone: 'El origen ya no está disponible; no se pudo analizar de nuevo.', justNow: 'ahora mismo', minAgo: (n) => `hace ${n} min`, hourAgo: (n) => `hace ${n} h`, yesterday: 'ayer', downloads: (n) => n === 1 ? '1 descarga' : `${n} descargas`,
  },
};
const t = (k) => (L[navigator.language?.startsWith('es') ? 'es' : 'en'][k]) ?? L.en[k] ?? k;
document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
document.querySelectorAll('[data-i18n-ph]').forEach((e) => { e.placeholder = t(e.dataset.i18nPh); });
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = (m) => api.runtime.sendMessage(m);
let tabId, lastSig = '', selected = {}, view = 'videos', hLastSig = '', hSearch = '';
const fmtB = (b) => b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b || 0} B`;
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t('justNow');
  if (m < 60) return t('minAgo')(m);
  if (m < 24 * 60) return t('hourAgo')(Math.round(m / 60));
  return new Date(ts).toLocaleDateString(navigator.language, { day: 'numeric', month: 'short' });
}
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); else if (v === false) e[k === 'hidden' ? 'hidden' : k] = v; }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
};
const SVB = 'http://www.w3.org/2000/svg';
const svg = (d) => { const s = document.createElementNS(SVB, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); for (const p of [].concat(d)) { const el = document.createElementNS(SVB, 'path'); el.setAttribute('d', p); s.append(el); } return s; };
const IC = {
  redl: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v5h-5'],
  open: ['M6 4l14 8-14 8z'],
  folder: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'],
  copy: ['M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z', 'M15 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1'],
  trash: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6'],
  check: ['M20 6L9 17l-5-5'],
};
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
  }
}
const copyBtn = (url, tip) => h('button', { class: 'icob', type: 'button', title: tip, 'aria-label': tip, onclick: async (e) => { const ok = await copyText(url); if (!ok) return; e.currentTarget.classList.add('ok'); e.currentTarget.replaceChildren(svg(IC.check)); setTimeout(() => { e.currentTarget.classList.remove('ok'); e.currentTarget.replaceChildren(svg(IC.copy)); }, 1200); } }, svg(IC.copy));
let tick = () => {};

// ================= videos view =================
async function refresh() {
  const st = await send({ type: 'getState', tabId });
  if (!st) return;
  $('#auto').checked = !!st.settings.auto;
  if (document.activeElement !== $('#maxGB')) $('#maxGB').value = String(st.settings.maxGB || 0);
  const sig = JSON.stringify(st.items.map((i) => [i.id, i.state, i.problem, i.options.length, i.job?.status, i.job?.id]));
  if (sig !== lastSig) { lastSig = sig; render(st); }
  for (const i of st.items) updateProgress(i);
}
const host = (u) => { try { return new URL(u).host; } catch { return u; } };
function render(st) {
  const list = $('#list'); list.replaceChildren();
  $('#empty').hidden = st.items.length > 0; $('#emptyMsg').textContent = st.blob ? t('blob') : t('none');
  $('#emptyMsg').style.whiteSpace = 'pre-line';
  for (const i of st.items) {
    const u = new URL(i.url);
    const kind = { hls: 'HLS', dash: 'DASH' }[i.kind] || (/\.(w{2,4})(?:$|\?)/.exec(u.pathname)?.[1] || 'FILE').toUpperCase();
    const dur = i.duration ? ` · ${Math.floor(i.duration / 60)}:${String(Math.round(i.duration % 60)).padStart(2, '0')}` : '';
    const size = i.size ? ` · ${(i.size / 1048576).toFixed(1)} MB` : '';
    const busy = i.job && ['running', 'muxing', 'saving'].includes(i.job.status);
    let sel = null;
    if (i.options.length > 1) sel = h('select', { 'data-opt': true, onchange: (e) => { selected[i.id] = e.target.value; } }, i.options.map((o) => h('option', { value: o.id, selected: selected[i.id] === o.id }, o.label)));
    const info = !sel && i.options.length === 1 && i.options[0].label !== 'Default' ? h('span', { class: 'sub' }, i.options[0].label) : null;
    const dl = h('button', { class: 'primary', disabled: !!(i.problem || busy), onclick: () => { send({ type: 'download', tabId, itemId: i.id, optionId: sel?.value ?? '0' }).then(refresh); } }, t('download'));
    list.append(h('div', { class: 'card', 'data-id': i.id },
      h('div', { class: 'top' }, h('span', { class: 'badge' }, kind), h('div', { class: 'title', title: i.title }, i.title || u.hostname)),
      h('div', { class: 'sub', title: i.url }, u.host + u.pathname + dur + size),
      i.problem ? h('div', { class: 'msg err' }, t(i.problem)) : i.live ? h('div', { class: 'msg' }, t('live')) : null,
      h('div', { class: 'row' }, i.state === 'analyzing' ? h('span', { class: 'sub' }, t('analyzing')) : [sel, info, dl, busy ? h('button', { onclick: () => send({ type: 'cancel', jobId: i.job.id }) }, t('cancel')) : null, copyBtn(i.url, t('copyCard'))]),
      h('div', { class: 'bar', hidden: !i.job }, h('i')), h('div', { class: 'msg', 'data-status': true })));
  }
}
function updateProgress(i) {
  const card = document.querySelector(`.card[data-id="${i.id}"]`); const j = i.job; if (!card || !j) return;
  card.querySelector('.bar > i').style.width = `${j.pct}%`;
  const s = card.querySelector('[data-status]');
  const mb = j.bytes ? ` · ${(j.bytes / 1048576).toFixed(1)} MB` : '';
  s.className = `msg ${j.status === 'error' ? 'err' : j.status === 'done' ? 'ok' : ''}`;
  s.textContent = j.status === 'error' ? (j.error.startsWith('SIZE_LIMIT') ? t('limitHit') : `${t('error')}: ${j.error}`) : j.status === 'running' ? `${t('running')} ${j.pct}%${mb}` : t(j.status) || j.status;
}
$('#clear').addEventListener('click', async () => { await send({ type: 'clear', tabId }); lastSig = ''; refresh(); });
$('#maxGB').addEventListener('change', (e) => send({ type: 'setSettings', settings: { maxGB: +e.target.value } }));
$('#auto').addEventListener('change', (e) => send({ type: 'setSettings', settings: { auto: e.target.checked } }));

// ================= history view =================
function setView(v) {
  view = v; document.body.dataset.view = v;
  $('#tabVids').classList.toggle('active', v === 'videos'); $('#tabHist').classList.toggle('active', v === 'history');
  $('#viewVids').hidden = v !== 'videos'; $('#viewHist').hidden = v !== 'history';
  $('#footVids').hidden = v !== 'videos'; $('#footHist').hidden = v !== 'history';
  lastSig = ''; hLastSig = ''; tick();
}
$('#tabVids').addEventListener('click', () => setView('videos'));
$('#tabHist').addEventListener('click', () => setView('history'));
$('#hsearch').addEventListener('input', (e) => { hSearch = e.target.value.trim().toLowerCase(); hLastSig = ''; refresh(); });
// clear-all is armed by the first click and confirmed by a second click (no blocking dialogs)
let armed = 0;
$('#hclear').addEventListener('click', async (e) => {
  if (!armed) { armed = Date.now(); e.currentTarget.textContent = t('sure'); e.currentTarget.classList.add('armed'); setTimeout(resetArm, 3500); return; }
  resetArm(); await send({ type: 'histClear' }); hLastSig = ''; tick();
});
function resetArm() { armed = 0; const b = $('#hclear'); b.textContent = t('hClear'); b.classList.remove('armed'); }

async function refreshHist() {
  const st = await send({ type: 'getHistory' });
  if (!st) return;
  $('#hcount').hidden = !st.items.length; $('#hcount').textContent = st.stats.count;
  $('#hstats').textContent = st.items.length ? `${t('downloads')(st.stats.count)} · ${fmtB(st.stats.bytes)}` : '';
  const q = hSearch.toLowerCase();
  const shown = q ? st.items.filter((e) => `${e.title} ${e.filename} ${host(e.srcUrl || '')}`.toLowerCase().includes(q)) : st.items;
  const jobBy = {}; for (const j of st.jobs) jobBy[j.histId] = j;
  const sig = JSON.stringify([shown.map((e) => e.id), shown.map((e) => !!jobBy[e.id] && ['running', 'muxing', 'saving'].includes(jobBy[e.id].status)), hSearch]);
  if (sig !== hLastSig) { hLastSig = sig; renderHist(shown, jobBy); }
  for (const j of st.jobs) updateHistProgress(j);
}
tick = () => (view === 'videos' ? refresh() : refreshHist());
function renderHist(shown, jobBy) {
  const list = $('#hlist'); list.replaceChildren();
  $('#hempty').hidden = shown.length > 0 || !!hSearch; $('#hsearch').hidden = false;
  for (const e of shown) {
    const j = jobBy[e.id];
    const busy = j && ['running', 'muxing', 'saving'].includes(j.status);
    const badge = { hls: 'HLS', dash: 'DASH' }[e.kind] || 'FILE';
    const optSel = (e.options || []).length > 1
      ? h('select', { class: 'opts', 'data-hopt': true, title: t('download') }, (e.options || []).map((o) => h('option', { value: o.id, selected: o.id === String(e.optionId) }, o.label)))
      : null;
    const icoBtn = (ic, tip, fn, disabled) => h('button', { class: 'icob', type: 'button', title: tip, 'aria-label': tip, disabled: !!disabled, onclick: fn }, svg(IC[ic]));
    const src = e.srcUrl || ''; const pg = e.pageUrl || src;
    const meta = [e.quality, fmtB(e.size || 0), ago(e.fin)].filter(Boolean).join(' · ');
    list.append(h('div', { class: 'card', 'data-hist': e.id },
      h('div', { class: 'top' },
        h('span', { class: `badge${badge === 'FILE' ? ' dim' : ''}` }, badge),
        h('div', { class: 'title', title: e.filename }, e.filename),
        h('span', { class: 'q' }, 'MP4')),
      h('div', { class: 'histrow' }, h('div', { class: 'sub', title: `${pg}\n${src}` }, `${host(pg === src ? src : pg)} · ${meta}`)),
      h('div', { class: 'row' },
        busy ? h('span', { class: 'sub' }, t(j.status === 'muxing' ? 'muxing' : j.status === 'saving' ? 'saving' : 'running'))
          : [optSel, h('button', { class: 'primary', onclick: () => send({ type: 'histDownload', histId: e.id, optionId: optSel?.value || e.optionId || '0' }).then(refreshHist) }, t('download'))],
        h('div', { class: 'hacts' },
          e.dlId ? icoBtn('open', t('hOpen'), () => send({ type: 'openFile', dlId: e.dlId })) : null,
          e.dlId ? icoBtn('folder', t('hFolder'), () => send({ type: 'showFile', dlId: e.dlId })) : null,
          src ? copyBtn(src, t('hCopy')) : null,
          icoBtn('trash', t('hDel'), async () => { await send({ type: 'histRemove', histId: e.id }); hLastSig = ''; tick(); }))),
      h('div', { class: 'bar', hidden: !busy }, h('i')), busy ? h('div', { class: 'msg', 'data-hjob': e.id }) : null));
  }
}
function updateHistProgress(j) {
  const el = document.querySelector(`[data-hjob="${j.histId}"]`); if (!el) return;
  const card = el.closest('.card');
  card.querySelectorAll('.bar > i').forEach((b) => { b.style.width = `${j.pct}%`; });
  const mb = j.bytes ? ` · ${(j.bytes / 1048576).toFixed(1)} MB` : '';
  const busy = ['running', 'muxing', 'saving'].includes(j.status);
  if (!busy) { el.remove(); hLastSig = ''; refreshHist(); return; }
  el.className = `msg${j.status === 'error' ? ' err' : ''}`;
  el.textContent = j.status === 'error' ? (String(j.error).startsWith('SIZE_LIMIT') ? t('limitHit') : `${t('error')}: ${j.error}`) : `${t(j.status) || j.status} ${j.pct}%${mb}`;
}

(async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = +(new URLSearchParams(location.search).get('tab')) || tab?.id; setView('videos'); setInterval(() => tick(), 600);
})();
