import { parseXml, kids, kid } from './xml.js';
import { resolveUrl } from './util.js';

export function parseIsoDuration(s) {
  if (!s) return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

function expand(tpl, { id, bandwidth, number, time }) {
  return tpl.replace(/\$(RepresentationID|Number|Bandwidth|Time)(?:%0(\d+)d)?\$/g, (_m, k, pad) => {
    const v = { RepresentationID: id, Number: number, Bandwidth: bandwidth, Time: time }[k];
    return pad ? String(v).padStart(+pad, '0') : String(v);
  }).replace(/\$\$/g, '$');
}
const mergeAttrs = (...els) => Object.assign({}, ...els.filter(Boolean).map((e) => e.attrs));
const baseOf = (el, parent) => { const b = kid(el, 'BaseURL'); return b ? resolveUrl(b.text.trim(), parent) : parent; };

/** Parse a DASH MPD into {video:[], audio:[], encrypted, dynamic, duration}. */
export function parseDash(text, mpdUrl) {
  const mpd = parseXml(text);
  if (!mpd || mpd.name !== 'MPD') throw new Error('Not a DASH manifest');
  const dynamic = mpd.attrs.type === 'dynamic';
  const mpdBase = baseOf(mpd, mpdUrl);
  const periods = kids(mpd, 'Period');
  const total = parseIsoDuration(mpd.attrs.mediaPresentationDuration);
  const pDur = (p) => parseIsoDuration(p.attrs.duration) || total / Math.max(1, periods.length);
  // Use the longest period (typically the main content, skipping short ad periods)
  const period = periods.slice().sort((a, b) => pDur(b) - pDur(a))[0];
  if (!period) throw new Error('MPD has no Period');
  const periodDuration = pDur(period) || total;
  const periodBase = baseOf(period, mpdBase);
  const out = { video: [], audio: [], encrypted: false, dynamic, duration: periodDuration };

  for (const as of kids(period, 'AdaptationSet')) {
    const asBase = baseOf(as, periodBase);
    if (kids(as, 'ContentProtection').length) out.encrypted = true;
    for (const rep of kids(as, 'Representation')) {
      if (kids(rep, 'ContentProtection').length) out.encrypted = true;
      const a = mergeAttrs(as, rep);
      const mime = a.mimeType || '';
      const ctype = a.contentType || mime.split('/')[0] || (a.codecs && /^(avc|hev|hvc|vp|av01)/.test(a.codecs) ? 'video' : a.codecs && /^(mp4a|ac-3|ec-3|opus)/.test(a.codecs) ? 'audio' : '');
      if (ctype !== 'video' && ctype !== 'audio') continue;
      const base = baseOf(rep, asBase);
      const st = kid(rep, 'SegmentTemplate') || kid(as, 'SegmentTemplate');
      const sl = kid(rep, 'SegmentList') || kid(as, 'SegmentList');
      const sb = kid(rep, 'SegmentBase') || kid(as, 'SegmentBase');
      const r = {
        id: rep.attrs.id, type: ctype, bandwidth: +a.bandwidth || 0, width: +a.width || 0, height: +a.height || 0,
        codecs: a.codecs || '', mimeType: mime, lang: a.lang || '', frameRate: a.frameRate || '',
        init: null, segments: [], single: false,
      };
      if (st) {
        const t = st.attrs, timescale = +t.timescale || 1;
        const ctx = { id: r.id, bandwidth: r.bandwidth };
        if (t.initialization) r.init = { url: resolveUrl(expand(t.initialization, ctx), base) };
        const media = t.media;
        const tl = kid(st, 'SegmentTimeline');
        if (tl) {
          let time = 0, num = +(t.startNumber ?? 1);
          for (const s of kids(tl, 'S')) {
            if (s.attrs.t !== undefined) time = +s.attrs.t;
            const d = +s.attrs.d; let rep_ = +(s.attrs.r || 0);
            if (rep_ < 0) rep_ = Math.max(0, Math.ceil(((periodDuration * timescale) - time) / d) - 1);
            for (let i = 0; i <= rep_; i++) {
              r.segments.push({ url: resolveUrl(expand(media, { ...ctx, number: num++, time }), base) });
              time += d;
            }
          }
        } else {
          const d = +t.duration; const start = +(t.startNumber ?? 1);
          if (!d) throw new Error('SegmentTemplate without duration/timeline');
          const count = Math.ceil((periodDuration * timescale) / d);
          for (let i = 0; i < count; i++) r.segments.push({ url: resolveUrl(expand(media, { ...ctx, number: start + i, time: i * d }), base) });
        }
      } else if (sl) {
        const ini = kid(sl, 'Initialization');
        if (ini) r.init = { url: resolveUrl(ini.attrs.sourceURL || '', base) || base, range: ini.attrs.range ? ini.attrs.range.split('-').map(Number) : null };
        for (const u of kids(sl, 'SegmentURL')) {
          r.segments.push({ url: u.attrs.media ? resolveUrl(u.attrs.media, base) : base, range: u.attrs.mediaRange ? u.attrs.mediaRange.split('-').map(Number) : null });
        }
      } else if (sb || kid(rep, 'BaseURL')) {
        r.single = true; r.segments.push({ url: base }); // whole file (fragmented MP4 with sidx)
      } else continue;
      out[ctype].push(r);
    }
  }
  const byQ = (a, b) => b.height - a.height || b.bandwidth - a.bandwidth;
  out.video.sort(byQ); out.audio.sort((a, b) => b.bandwidth - a.bandwidth);
  return out;
}
