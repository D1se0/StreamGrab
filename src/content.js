// Isolated-world relay: page hook -> background, and page info (poster/thumbnail) for the popup.
const api = globalThis.browser ?? globalThis.chrome;
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.source !== 'streamgrab') return;
  if (d.type === 'manifest' && typeof d.url === 'string') api.runtime.sendMessage({ target: 'bg', type: 'sniffed', url: d.url, frameUrl: location.href }).catch?.(() => {});
  else if (d.type === 'blob') api.runtime.sendMessage({ target: 'bg', type: 'blob' }).catch?.(() => {});
});
api.runtime.onMessage.addListener((m, _s, send) => {
  if (m?.type !== 'pageInfo' || window !== window.top) return false;
  const abs = (u) => { try { return u ? new URL(u, location.href).href : ''; } catch { return ''; } };
  const v = [...document.querySelectorAll('video[poster]')].find((x) => x.poster);
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content');
  send({ thumb: abs(v?.poster || meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]')), title: document.title });
  return false;
});
