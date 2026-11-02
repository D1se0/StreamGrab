import mux from 'mux.js';
import { parseHls } from './hls.js';
import { parseDash } from './dash.js';
import { buildMp4, splitFragmented } from './mp4.js';
import { fetchBytes, fetchText, orderedPool, AbortError } from './util.js';

const sniff = (b) => {
  if (b.length > 376 && b[0] === 0x47 && b[188] === 0x47) return 'ts';
  const t = String.fromCharCode(b[4], b[5], b[6], b[7]);
  if (['ftyp', 'styp', 'moof', 'sidx', 'moov'].includes(t)) return 'fmp4';
  if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xf0) === 0xf0)) return 'aac';
  return 'unknown';
};

async function aesDecrypt(data, keyBytes, iv) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data));
}
const seqIv = (seq) => { const iv = new Uint8Array(16); new DataView(iv.buffer).setUint32(12, seq >>> 0); return iv; };

class Progress {
  constructor(cb, maxBytes = 0) { this.cb = cb; this.maxBytes = maxBytes; this.total = 0; this.done = 0; this.bytes = 0; }
  add(n) { this.total += n; }
  tick(bytes) {
    this.done++; this.bytes += bytes;
    if (this.maxBytes && this.bytes > this.maxBytes) throw new Error(`SIZE_LIMIT:${this.maxBytes}`); this.cb?.({ phase: 'download', done: this.done, total: this.total, bytes: this.bytes }); }
}

function transmuxTs(segBytesIter) {
  return (async () => {
    const tm = new mux.mp4.Transmuxer({ keepOriginalTimestamps: true });
    let init = null; const chunks = [];
    tm.on('data', (s) => { if (!init) init = s.initSegment; chunks.push(new Blob([s.data])); });
    for await (const bytes of segBytesIter) { tm.push(bytes); tm.flush(); }
    if (!init) throw new Error('Could not transmux TS (unsupported codec? only H.264/AAC are supported in MPEG-TS)');
    return { init: new Uint8Array(init), chunks };
  })();
}

/** Download one HLS media playlist into a source {init, chunks} ready for buildMp4. */
async function hlsMediaToSource(playlistUrl, o, progress) {
  const pl = parseHls(await fetchText(playlistUrl, o), playlistUrl);
  if (pl.type !== 'media') throw new Error('Expected a media playlist');
  const segs = pl.segments;
  if (!segs.length) throw new Error('Playlist has no segments');
  const keyCache = new Map();
  const getKey = (k) => { if (!keyCache.has(k.url)) keyCache.set(k.url, fetchBytes(k.url, o)); return keyCache.get(k.url); };
  const mapUrl = segs[0].map;
  progress.add(segs.length + (mapUrl ? 1 : 0));
  const fetchSeg = (s) => async () => {
    let data = await fetchBytes(s.url, { ...o, range: s.range });
    if (s.key) {
      if (s.key.method !== 'AES-128') throw new Error(`Unsupported HLS encryption ${s.key.method} (DRM)`);
      if (s.key.format !== 'identity') throw new Error('DRM-protected stream (non-identity key format)');
      data = await aesDecrypt(data, await getKey(s.key), s.key.iv || seqIv(s.seq));
    }
    progress.tick(data.length);
    return data;
  };
  let initBytes = null;
  if (mapUrl) { initBytes = await fetchBytes(mapUrl.url, { ...o, range: mapUrl.range }); progress.tick(initBytes.length); }
  const iter = orderedPool(segs.map(fetchSeg), o.concurrency || 6, o.signal);
  // peek first segment to detect container
  const first = await iter.next();
  const fmt = sniff(first.value);
  async function* all() { yield first.value; for await (const v of iter) yield v; }
  if (fmt === 'ts') return transmuxTs(all());
  if (fmt === 'fmp4') {
    const chunks = []; let firstSeg = true; let init = initBytes;
    for await (const c of all()) {
      if (firstSeg && !init) { const sp = splitFragmented(c); init = sp.init; chunks.push(new Blob([sp.media])); } else chunks.push(new Blob([c]));
      firstSeg = false;
    }
    return { init, chunks };
  }
  if (fmt === 'aac') throw new Error('Packed-AAC (ADTS) HLS audio is not supported yet');
  throw new Error('Unknown HLS segment container');
}

async function downloadHls(url, optionId, o, progress) {
  const pl = parseHls(await fetchText(url, o), url);
  const sources = [];
  if (pl.type === 'master') {
    const v = pl.variants[+optionId || 0];
    if (!v) throw new Error('Quality not found');
    const audio = v.audioGroup ? (pl.audio.filter((a) => a.group === v.audioGroup).sort((a, b) => b.default - a.default)[0]) : null;
    sources.push(await hlsMediaToSource(v.url, o, progress));
    if (audio) sources.push(await hlsMediaToSource(audio.url, o, progress));
  } else sources.push(await hlsMediaToSource(url, o, progress));
  return sources;
}

async function repToSource(rep, o, progress) {
  progress.add(rep.segments.length + (rep.init ? 1 : 0));
  if (/webm|vp8|vp9|opus/i.test(rep.mimeType + rep.codecs)) throw new Error('WebM/VP9 DASH is not supported (only MP4/H.264/AAC)');
  if (rep.single) {
    const bytes = await fetchBytes(rep.segments[0].url, o); progress.tick(bytes.length);
    const sp = splitFragmented(bytes); return { init: sp.init, chunks: [new Blob([sp.media])], absStart: sp.mediaOffset };
  }
  let init = null;
  if (rep.init) { init = await fetchBytes(rep.init.url, { ...o, range: rep.init.range }); progress.tick(init.length); }
  const chunks = [];
  const tasks = rep.segments.map((s) => async () => { const b = await fetchBytes(s.url, { ...o, range: s.range }); progress.tick(b.length); return b; });
  for await (const b of orderedPool(tasks, o.concurrency || 6, o.signal)) chunks.push(chunks.length || init ? new Blob([b]) : b);
  if (!init) { const sp = splitFragmented(chunks[0]); init = sp.init; chunks[0] = new Blob([sp.media]); }
  return { init, chunks };
}

async function downloadDash(url, optionId, o, progress) {
  const d = parseDash(await fetchText(url, o), url);
  if (d.encrypted) throw new Error('This stream is DRM-protected and cannot be downloaded');
  const list = d.video.length ? d.video : d.audio;
  const rep = list[+optionId || 0]; if (!rep) throw new Error('Quality not found');
  const sources = [await repToSource(rep, o, progress)];
  if (d.video.length && d.audio.length) sources.push(await repToSource(d.audio[0], o, progress));
  return sources;
}

/**
 * Main entry. opts: {fetch, signal, concurrency, onProgress}
 * returns {blob, duration, tracks}
 */
export async function downloadStream(url, { optionId = '0', kind, maxBytes = 0, ...o } = {}) {
  const progress = new Progress(o.onProgress, maxBytes);
  const text = kind ? null : (await fetchText(url, o)).slice(0, 2000);
  const isHls = kind ? kind === 'hls' : text.includes('#EXTM3U');
  const sources = isHls ? await downloadHls(url, optionId, o, progress) : await downloadDash(url, optionId, o, progress);
  if (o.signal?.aborted) throw new AbortError();
  o.onProgress?.({ phase: 'mux', done: progress.done, total: progress.total, bytes: progress.bytes });
  const out = await buildMp4(sources, { force64: o.force64 });
  return { blob: new Blob(out.parts, { type: 'video/mp4' }), duration: out.duration, tracks: out.tracks, size: out.size };
}
