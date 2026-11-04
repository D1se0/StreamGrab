import { parseHls } from './hls.js';
import { parseDash } from './dash.js';
import { fetchText } from './util.js';

const fmtRate = (bps) => (bps ? (bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbps` : `${Math.round(bps / 1e3)} kbps`) : '');
export const optionLabel = (o) => [o.height ? `${o.height}p` : o.audioOnly ? 'Audio' : '', o.frameRate && +o.frameRate > 30 ? `${Math.round(o.frameRate)}fps` : '', fmtRate(o.bandwidth)].filter(Boolean).join(' · ') || 'Default';

/** Fetch + classify + parse a manifest. Never throws for "unsupported"; reports it in `problem`. */
export async function analyzeManifest(url, opts = {}) {
  const text = await fetchText(url, opts);
  const head = text.slice(0, 2000);
  if (head.includes('#EXTM3U')) {
    const pl = parseHls(text, url);
    if (pl.type === 'master') {
      let duration, live, problem = pl.variants.length ? null : 'empty';
      try { // peek at the best variant: gives duration (size estimate), live flag, and detects DRM before downloading
        const first = parseHls(await fetchText(pl.variants[0].url, opts), pl.variants[0].url);
        if (first.type === 'media') {
          duration = first.duration; live = !first.endlist;
          const k = first.segments.find((x) => x.key)?.key;
          if (k && (k.method !== 'AES-128' || k.format !== 'identity')) problem = 'drm';
        }
      } catch { /* variant unreachable: still list qualities */ }
      return { kind: 'hls', url, isMaster: true, duration, live, options: pl.variants.map((v, i) => ({ id: String(i), width: v.width, height: v.height, bandwidth: v.bandwidth, codecs: v.codecs, frameRate: v.frameRate, label: optionLabel(v), url: v.url })), childUrls: pl.variants.map((v) => v.url).concat(pl.audio.map((a) => a.url)), problem };
    }
    const enc = pl.segments.find((s) => s.key)?.key;
    let problem = null;
    if (enc && enc.method !== 'AES-128') problem = 'drm';
    else if (enc && enc.format !== 'identity') problem = 'drm';
    else if (!pl.segments.length) problem = 'empty';
    return { kind: 'hls', url, isMaster: false, duration: pl.duration, live: !pl.endlist, options: [{ id: '0', label: 'Default', bandwidth: 0 }], problem };
  }
  if (head.includes('<MPD')) {
    const d = parseDash(text, url);
    const list = d.video.length ? d.video : d.audio;
    const problem = d.encrypted ? 'drm' : !list.length ? 'empty' : list.every((r) => /webm|vp9|vp8|opus/i.test(r.mimeType + r.codecs)) ? 'webm' : null;
    return {
      kind: 'dash', url, isMaster: true, duration: d.duration, live: d.dynamic, problem,
      options: list.map((r, i) => ({ id: String(i), width: r.width, height: r.height, bandwidth: r.bandwidth, codecs: r.codecs, frameRate: r.frameRate, audioOnly: !d.video.length, label: optionLabel({ ...r, audioOnly: !d.video.length }) })),
    };
  }
  throw new Error('Not a recognised manifest');
}
