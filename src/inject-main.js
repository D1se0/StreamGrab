// Runs in the PAGE's JS world (document_start). Spots manifests that webRequest cannot classify
// (no extension, generic content-type) and reports blob: media usage. Never trusted by the background.
(() => {
  if (window.__streamgrabHooked) return; window.__streamgrabHooked = true;
  const seen = new Set();
  const report = (msg) => { try { window.postMessage({ source: 'streamgrab', ...msg }, '*'); } catch { /* ignore */ } };
  const looksManifest = (s) => /^\s*#EXTM3U/.test(s) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?<MPD[\s>]/.test(s);
  const peek = (url, head) => { if (!seen.has(url) && looksManifest(head)) { seen.add(url); report({ type: 'manifest', url }); } };
  const skipCt = /^(video|audio|image|font)\/|javascript|css|html|wasm/i;

  const _fetch = window.fetch;
  window.fetch = function (...args) {
    const p = _fetch.apply(this, args);
    p.then((res) => {
      try {
        const ct = res.headers.get('content-type') || '';
        const len = +(res.headers.get('content-length') || 0);
        if (!res.ok || skipCt.test(ct) || len > 5e6) return;
        const rd = res.clone().body?.getReader(); if (!rd) return;
        rd.read().then(({ value }) => { rd.cancel().catch(() => {}); if (value) peek(res.url, new TextDecoder().decode(value.subarray(0, 600))); }).catch(() => {});
      } catch { /* ignore */ }
    }).catch(() => {});
    return p;
  };
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...a) {
    this.addEventListener('load', () => {
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (this.status >= 400 || skipCt.test(ct)) return;
        let head = '';
        if (this.responseType === '' || this.responseType === 'text') head = String(this.responseText).slice(0, 600);
        else if (this.responseType === 'arraybuffer' && this.response) head = new TextDecoder().decode(new Uint8Array(this.response, 0, Math.min(600, this.response.byteLength)));
        if (head) peek(this.responseURL, head);
      } catch { /* ignore */ }
    });
    return _open.apply(this, a);
  };
  const _cou = URL.createObjectURL;
  URL.createObjectURL = function (o) {
    const u = _cou.apply(this, arguments);
    if (typeof MediaSource !== 'undefined' && o instanceof MediaSource) report({ type: 'blob' });
    return u;
  };
})();
