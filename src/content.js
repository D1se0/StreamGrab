// Isolated-world relay: page hook -> background.
const api = globalThis.browser ?? globalThis.chrome;
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.source !== 'streamgrab') return;
  if (d.type === 'manifest' && typeof d.url === 'string') api.runtime.sendMessage({ target: 'bg', type: 'sniffed', url: d.url, frameUrl: location.href }).catch?.(() => {});
  else if (d.type === 'blob') api.runtime.sendMessage({ target: 'bg', type: 'blob' }).catch?.(() => {});
});
