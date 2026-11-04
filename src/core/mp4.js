// Fragmented-MP4 -> regular, seekable, "faststart" MP4 muxer (also merges separate audio/video sources).
// Pure JS, no dependencies. Input: one or more sources {init, chunks[]} where `init` holds ftyp+moov of a
// fragmented MP4 and `chunks` are byte arrays containing moof+mdat pairs. Output: Blob parts of a classic MP4.

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function* boxes(buf, start = 0, end = buf.length) {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(buf, p), hdr = 8;
    const type = fourcc(buf, p + 4);
    if (size === 1) { size = u64(buf, p + 8); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr) return;
    yield { type, start: p, hdr, size: Math.min(size, end - p), dataStart: p + hdr, end: Math.min(p + size, end) };
    p += size;
  }
}
const child = (buf, b, type) => { for (const c of boxes(buf, b.dataStart, b.end)) if (c.type === type) return c; return null; };
const children = (buf, b, type) => [...boxes(buf, b.dataStart, b.end)].filter((c) => c.type === type);

// ---- writers ----
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n) => [(n >>> 8) & 255, n & 255];
function cat(parts) {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const box = (type, ...parts) => { const body = cat(parts); return cat([be32(8 + body.length), [...type].map((c) => c.charCodeAt(0)), body]); };
const full = (type, ver, flags, ...parts) => box(type, [ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
/** Big-endian uint32 table from a plain number array (never spread big arrays into call args: stack overflow). */
function u32s(arr) { const o = new Uint8Array(arr.length * 4); const dv = new DataView(o.buffer); for (let i = 0; i < arr.length; i++) dv.setUint32(i * 4, arr[i] >>> 0); return o; }
function u64s(arr) { const o = new Uint8Array(arr.length * 8); const dv = new DataView(o.buffer); for (let i = 0; i < arr.length; i++) { dv.setUint32(i * 8, Math.floor(arr[i] / 4294967296)); dv.setUint32(i * 8 + 4, arr[i] >>> 0); } return o; }
const MATRIX = [...be32(0x10000), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...be32(0x10000), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...be32(0x40000000)];

/** Split a (possibly whole) fragmented MP4 file into {init, media}. */
export function splitFragmented(bytes) {
  let moovEnd = -1, hasMoof = false;
  for (const b of boxes(bytes)) {
    if (b.type === 'moov') moovEnd = b.end;
    if (b.type === 'moof') { hasMoof = true; break; }
  }
  if (moovEnd < 0) throw new Error('MP4 without moov box');
  if (!hasMoof) throw new Error('MP4 is not fragmented (no moof) – unsupported source layout');
  return { init: bytes.subarray(0, moovEnd), media: bytes.subarray(moovEnd), mediaOffset: moovEnd };
}

function parseInit(init) {
  const moov = [...boxes(init)].find((b) => b.type === 'moov');
  if (!moov) throw new Error('init segment has no moov');
  const trex = new Map();
  const mvex = child(init, moov, 'mvex');
  if (mvex) for (const t of children(init, mvex, 'trex')) {
    const d = t.dataStart; trex.set(u32(init, d + 4), { descIdx: u32(init, d + 8), dur: u32(init, d + 12), size: u32(init, d + 16), flags: u32(init, d + 20) });
  }
  const tracks = new Map();
  for (const trak of children(init, moov, 'trak')) {
    const tkhd = child(init, trak, 'tkhd'), mdia = child(init, trak, 'mdia');
    if (!tkhd || !mdia) continue;
    const v = init[tkhd.dataStart], base = tkhd.dataStart + 4, sh = v === 1 ? 8 : 0;
    const id = u32(init, base + 8 + sh);
    const mdhd = child(init, mdia, 'mdhd'), hdlr = child(init, mdia, 'hdlr'), minf = child(init, mdia, 'minf');
    if (!mdhd || !hdlr || !minf) continue;
    const mv = init[mdhd.dataStart], mb = mdhd.dataStart + 4;
    const timescale = u32(init, mb + (mv === 1 ? 16 : 8));
    const lang = u16(init, mb + (mv === 1 ? 28 : 16));
    const handler = fourcc(init, hdlr.dataStart + 8);
    if (handler !== 'vide' && handler !== 'soun') continue;
    const stbl = child(init, minf, 'stbl'); const stsd = stbl && child(init, stbl, 'stsd');
    if (!stsd) continue;
    const raw = (b) => (b ? init.slice(b.start, b.end) : null);
    tracks.set(id, {
      srcId: id, handler, timescale, lang,
      width: u32(init, base + 72 + sh), height: u32(init, base + 76 + sh),
      hdlr: raw(hdlr), stsd: raw(stsd), dinf: raw(child(init, minf, 'dinf')),
      mhd: raw(child(init, minf, 'vmhd')) || raw(child(init, minf, 'smhd')),
      trex: trex.get(id) || { descIdx: 1, dur: 0, size: 0, flags: 0 },
      samples: [], firstDts: null, nextDts: 0,
    });
  }
  if (!tracks.size) throw new Error('no audio/video track found in init segment');
  return tracks;
}

const chunkSize = (c) => (c instanceof Uint8Array ? c.length : c.size);
const chunkRead = async (c, a, b) => (c instanceof Uint8Array ? c.subarray(a, b) : new Uint8Array(await c.slice(a, b).arrayBuffer()));
const chunkSlice = (c, a, b) => (c instanceof Uint8Array ? c.subarray(a, b) : c.slice(a, b));

/** Chunks may be Uint8Array or Blob (Blobs are disk-backed by the browser, so hours of video do not need RAM). */
async function parseChunk(chunk, chunkIdx, tracks, absStart) {
  const total = chunkSize(chunk);
  let p = 0;
  while (p + 8 <= total) {
    const head = await chunkRead(chunk, p, Math.min(p + 16, total));
    let size = u32(head, 0); const type = fourcc(head, 4);
    if (size === 1) size = u64(head, 8); else if (size === 0) size = total - p;
    if (size < 8) break;
    if (type === 'moof') parseMoof(await chunkRead(chunk, p, Math.min(p + size, total)), p, chunkIdx, tracks, absStart);
    p += size;
  }
}

/** buf = bytes of ONE moof box; shift = position of that moof inside its chunk. Sample offsets are chunk-relative. */
function parseMoof(buf, shift, chunkIdx, tracks, absStart) {
  for (const moof of boxes(buf)) {
    if (moof.type !== 'moof') continue;
    for (const traf of children(buf, moof, 'traf')) {
      const tfhd = child(buf, traf, 'tfhd'); if (!tfhd) continue;
      const tf = (buf[tfhd.dataStart + 1] << 16) | (buf[tfhd.dataStart + 2] << 8) | buf[tfhd.dataStart + 3];
      let p = tfhd.dataStart + 4; const trackId = u32(buf, p); p += 4;
      const track = tracks.get(trackId); if (!track) continue;
      let baseOff = shift;
      if (tf & 1) { baseOff = u64(buf, p) - absStart; p += 8; }
      if (tf & 2) p += 4;
      let defDur = track.trex.dur, defSize = track.trex.size, defFlags = track.trex.flags;
      if (tf & 8) { defDur = u32(buf, p); p += 4; }
      if (tf & 0x10) { defSize = u32(buf, p); p += 4; }
      if (tf & 0x20) { defFlags = u32(buf, p); p += 4; }
      const tfdt = child(buf, traf, 'tfdt');
      if (tfdt) {
        const v = buf[tfdt.dataStart]; const t = v === 1 ? u64(buf, tfdt.dataStart + 4) : u32(buf, tfdt.dataStart + 4);
        if (track.firstDts === null) track.firstDts = t;
      } else if (track.firstDts === null) track.firstDts = 0;
      let cursor = baseOff;
      for (const trun of children(buf, traf, 'trun')) {
        const ver = buf[trun.dataStart];
        const fl = (buf[trun.dataStart + 1] << 16) | (buf[trun.dataStart + 2] << 8) | buf[trun.dataStart + 3];
        let q = trun.dataStart + 4; const count = u32(buf, q); q += 4;
        if (fl & 1) { cursor = baseOff + i32(buf, q); q += 4; }
        let firstFlags = null; if (fl & 4) { firstFlags = u32(buf, q); q += 4; }
        for (let i = 0; i < count; i++) {
          let dur = defDur, size = defSize, flags = defFlags, cto = 0;
          if (fl & 0x100) { dur = u32(buf, q); q += 4; }
          if (fl & 0x200) { size = u32(buf, q); q += 4; }
          if (fl & 0x400) { flags = u32(buf, q); q += 4; } else if (i === 0 && firstFlags !== null) flags = firstFlags;
          if (fl & 0x800) { cto = ver === 1 ? i32(buf, q) : u32(buf, q); q += 4; }
          track.samples.push({ c: chunkIdx, o: cursor, s: size, d: dur, f: flags, t: cto });
          cursor += size;
        }
      }
    }
  }
}

const rle = (arr) => { const out = []; for (const v of arr) { const l = out[out.length - 1]; if (l && l[1] === v) l[0]++; else out.push([1, v]); } return out; };

/**
 * sources: [{init: Uint8Array, chunks: Uint8Array[]}]
 * chunks: Uint8Array | Blob. returns Promise<{parts: (Uint8Array|Blob)[], size, duration}>
 */
export async function buildMp4(sources, { force64 = false, only = '' } = {}) {
  let all = []; const chunkStore = [];
  for (const src of sources) {
    const tracks = parseInit(src.init);
    for (const c of src.chunks) { const idx = chunkStore.push(c) - 1; await parseChunk(c, idx, tracks, src.absStart || 0); }
    for (const t of tracks.values()) if (t.samples.length) all.push(t);
  }
  if (only) { all = all.filter((t) => t.handler === only); if (!all.length) throw new Error(only === 'soun' ? 'NO_AUDIO' : 'NO_VIDEO'); }
  if (!all.length) throw new Error('No media samples found');
  all.sort((a, b) => (a.handler === 'vide' ? 0 : 1) - (b.handler === 'vide' ? 0 : 1));
  const MT = 1000;
  // presentation start of each track (seconds), used to keep A/V in sync via edit lists
  for (const t of all) {
    t.firstCto = t.samples[0].t;
    t.ptsStart = ((t.firstDts || 0) + t.firstCto) / t.timescale;
    let dts = 0, maxEnd = 0;
    for (const x of t.samples) { maxEnd = Math.max(maxEnd, dts + x.t + x.d); dts += x.d; }
    t.mediaDur = dts; t.presEnd = maxEnd; // presentation end (can exceed the DTS end because of B-frame reordering)
  }
  const origin = Math.min(...all.map((t) => t.ptsStart));
  all.forEach((t, i) => {
    t.id = i + 1; t.delay = t.ptsStart - origin;
    t.editDur = Math.round((t.presEnd - t.firstCto) / t.timescale * MT);
    t.movieDur = Math.round(t.delay * MT) + t.editDur;
    // group into ~1s interleave chunks
    t.chunks = []; let cur = null;
    t.samples.forEach((s, i2) => {
      if (!cur || cur.dur >= t.timescale) { cur = { track: t, first: i2, n: 0, dur: 0, startSec: 0 }; t.chunks.push(cur); }
      cur.n++; cur.dur += s.d;
    });
    let acc = 0; for (const c of t.chunks) { c.startSec = acc / t.timescale + t.delay; for (let k = c.first; k < c.first + c.n; k++) acc += t.samples[k].d; }
  });
  const order = all.flatMap((t) => t.chunks).sort((a, b) => a.startSec - b.startSec || a.track.id - b.track.id);

  const ftyp = box('ftyp', [...'isom'].map((c) => c.charCodeAt(0)), be32(512), [...'isomiso2avc1mp41'].map((c) => c.charCodeAt(0)));
  const movieDur = Math.max(...all.map((t) => t.movieDur));

  // >4 GB output: 64-bit chunk offsets (co64) + extended 'mdat' header
  const totalBytes = all.reduce((a, t) => a + t.samples.reduce((x, y) => x + y.s, 0), 0);
  const use64 = force64 || totalBytes > 0xffffffff - 256 * 1024 * 1024;
  const mdatHdr = use64 ? 16 : 8;

  const buildMoov = (mdatStart) => {
    // assign offsets
    let off = mdatStart;
    for (const c of order) { c.offset = off; for (let k = c.first; k < c.first + c.n; k++) off += c.track.samples[k].s; }
    const traks = all.map((t) => {
      const sm = t.samples, isV = t.handler === 'vide';
      const sttsRuns = rle(sm.map((s) => s.d));
      const sttsB = full('stts', 0, 0, be32(sttsRuns.length), u32s(sttsRuns.flat()));
      const hasCto = sm.some((s) => s.t !== 0); const signed = sm.some((s) => s.t < 0 || s.t > 0x7fffffff);
      const cttsRuns = rle(sm.map((s) => s.t));
      const cttsB = hasCto ? full('ctts', signed ? 1 : 0, 0, be32(cttsRuns.length), u32s(cttsRuns.flat())) : null;
      const syncIdx = []; sm.forEach((s, i) => { if (!(s.f & 0x10000)) syncIdx.push(i + 1); });
      const stssB = isV && syncIdx.length < sm.length ? full('stss', 0, 0, be32(syncIdx.length), u32s(syncIdx)) : null;
      const stszB = full('stsz', 0, 0, be32(0), be32(sm.length), u32s(sm.map((x) => x.s)));
      const scRuns = rle(t.chunks.map((c) => c.n)); let fc = 1; const scEntries = [];
      for (const [n, spc] of scRuns) { scEntries.push([fc, spc]); fc += n; }
      const stscB = full('stsc', 0, 0, be32(scEntries.length), u32s(scEntries.flatMap(([f, n]) => [f, n, 1])));
      const stcoB = use64 ? full('co64', 0, 0, be32(t.chunks.length), u64s(t.chunks.map((c) => c.offset))) : full('stco', 0, 0, be32(t.chunks.length), u32s(t.chunks.map((c) => c.offset)));
      const stbl = box('stbl', t.stsd, sttsB, ...(cttsB ? [cttsB] : []), ...(stssB ? [stssB] : []), stscB, stszB, stcoB);
      const dinf = t.dinf || box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1)));
      const mhd = t.mhd || (isV ? full('vmhd', 0, 1, [0, 0, 0, 0, 0, 0, 0, 0]) : full('smhd', 0, 0, [0, 0, 0, 0]));
      const mdhd = full('mdhd', 0, 0, be32(0), be32(0), be32(t.timescale), be32(t.mediaDur), be16(t.lang), be16(0));
      const mdia = box('mdia', mdhd, t.hdlr, box('minf', mhd, dinf, stbl));
      const tkhd = full('tkhd', 0, 3, be32(0), be32(0), be32(t.id), be32(0), be32(t.movieDur), [0, 0, 0, 0, 0, 0, 0, 0],
        be16(0), be16(0), be16(isV ? 0 : 0x0100), be16(0), MATRIX, be32(isV ? t.width : 0), be32(isV ? t.height : 0));
      const elstEntries = [];
      if (t.delay * MT >= 1) elstEntries.push([be32(Math.round(t.delay * MT)), be32(0xffffffff), be32(0x10000)]);
      elstEntries.push([be32(t.editDur), be32(t.firstCto), be32(0x10000)]);
      const edts = box('edts', full('elst', 0, 0, be32(elstEntries.length), ...elstEntries.flat()));
      return box('trak', tkhd, edts, mdia);
    });
    const mvhd = full('mvhd', 0, 0, be32(0), be32(0), be32(MT), be32(movieDur), be32(0x10000), be16(0x0100), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      MATRIX, new Uint8Array(24), be32(all.length + 1));
    return { moov: box('moov', mvhd, ...traks), total: off - mdatStart };
  };
  let m = buildMoov(0);
  const mdatStart = ftyp.length + m.moov.length + mdatHdr;
  m = buildMoov(mdatStart);
  const mdatBox = use64
    ? cat([be32(1), [...'mdat'].map((c) => c.charCodeAt(0)), be32(Math.floor((16 + m.total) / 4294967296)), be32((16 + m.total) >>> 0)])
    : cat([be32(8 + m.total), [...'mdat'].map((c) => c.charCodeAt(0))]);
  const parts = [ftyp, m.moov, mdatBox];
  for (const c of order) {
    const sm = c.track.samples; let k = c.first; const end = c.first + c.n;
    while (k < end) { // coalesce contiguous samples into a single slice
      const s0 = sm[k]; let len = s0.s, j = k + 1;
      while (j < end && sm[j].c === s0.c && sm[j].o === sm[j - 1].o + sm[j - 1].s) { len += sm[j].s; j++; }
      parts.push(chunkSlice(chunkStore[s0.c], s0.o, s0.o + len)); k = j;
    }
  }
  return { parts, size: mdatStart + m.total, duration: movieDur / MT, tracks: all.map((t) => ({ type: t.handler, samples: t.samples.length })) };
}
