import { resolveUrl } from './util.js';

function attrs(line) {
  const out = {}; const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g; let m;
  while ((m = re.exec(line))) out[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return out;
}
const hexToBytes = (hex) => {
  hex = hex.replace(/^0x/i, '').padStart(32, '0');
  return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
};

/** Parse an HLS playlist (master or media). */
export function parseHls(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('Not an HLS playlist');
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  return isMaster ? parseMaster(lines, baseUrl) : parseMedia(lines, baseUrl);
}

function parseMaster(lines, baseUrl) {
  const variants = [], audio = [], subtitles = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-STREAM-INF:')) {
      const a = attrs(l.slice(18));
      let j = i + 1; while (j < lines.length && lines[j].startsWith('#')) j++;
      if (!lines[j]) continue;
      const [w, h] = (a.RESOLUTION || '').split('x').map(Number);
      variants.push({
        url: resolveUrl(lines[j], baseUrl), bandwidth: +(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH || 0),
        width: w || 0, height: h || 0, codecs: a.CODECS || '', audioGroup: a.AUDIO || null,
        frameRate: a['FRAME-RATE'] ? +a['FRAME-RATE'] : 0,
      });
    } else if (l.startsWith('#EXT-X-MEDIA:')) {
      const a = attrs(l.slice(13));
      if (a.TYPE === 'AUDIO' && a.URI) audio.push({ url: resolveUrl(a.URI, baseUrl), group: a['GROUP-ID'], name: a.NAME, lang: a.LANGUAGE, default: a.DEFAULT === 'YES' });
      else if (a.TYPE === 'SUBTITLES' && a.URI) subtitles.push({ url: resolveUrl(a.URI, baseUrl), name: a.NAME, lang: a.LANGUAGE });
    }
  }
  variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  return { type: 'master', variants, audio, subtitles };
}

function parseMedia(lines, baseUrl) {
  const segments = []; let key = null, map = null, seq = 0, targetDuration = 0, endlist = false;
  let pendingDur = 0, pendingRange = null, lastRangeEnd = 0, discontinuity = false;
  for (const l of lines) {
    if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = +l.split(':')[1];
    else if (l.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = +l.split(':')[1];
    else if (l.startsWith('#EXT-X-ENDLIST')) endlist = true;
    else if (l.startsWith('#EXT-X-DISCONTINUITY') && !l.startsWith('#EXT-X-DISCONTINUITY-')) discontinuity = true;
    else if (l.startsWith('#EXT-X-KEY:')) {
      const a = attrs(l.slice(11));
      key = a.METHOD === 'NONE' ? null : { method: a.METHOD, url: a.URI ? resolveUrl(a.URI, baseUrl) : null, iv: a.IV ? hexToBytes(a.IV) : null, format: a.KEYFORMAT || 'identity' };
    } else if (l.startsWith('#EXT-X-MAP:')) {
      const a = attrs(l.slice(11));
      map = { url: resolveUrl(a.URI, baseUrl), range: a.BYTERANGE ? parseRange(a.BYTERANGE, 0) : null };
    } else if (l.startsWith('#EXTINF:')) pendingDur = parseFloat(l.slice(8));
    else if (l.startsWith('#EXT-X-BYTERANGE:')) pendingRange = l.slice(17);
    else if (!l.startsWith('#')) {
      let range = null;
      if (pendingRange) { range = parseRange(pendingRange, lastRangeEnd); lastRangeEnd = range[1] + 1; }
      segments.push({ url: resolveUrl(l, baseUrl), duration: pendingDur, range, key, map, seq: seq + segments.length, discontinuity });
      pendingDur = 0; pendingRange = null; discontinuity = false;
    }
  }
  return { type: 'media', segments, endlist, targetDuration, duration: segments.reduce((s, x) => s + x.duration, 0) };
}
function parseRange(s, defaultStart) {
  const [len, off] = s.split('@').map(Number);
  const start = off !== undefined && !Number.isNaN(off) ? off : defaultStart;
  return [start, start + len - 1];
}
