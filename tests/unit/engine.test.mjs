import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from '../helpers/server.mjs';
import { probe, decodeErrors } from '../helpers/ffprobe.mjs';
import { analyzeManifest } from '../../src/core/analyze.js';
import { downloadStream } from '../../src/core/download.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
let S;
before(async () => { S = await serve(root); });
after(() => S.close());

async function run(url, optionId) {
  const progress = [];
  const r = await downloadStream(url, { optionId, onProgress: (p) => progress.push(p) });
  const file = path.join(tmp, `${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(file, Buffer.from(await r.blob.arrayBuffer()));
  return { file, r, progress, info: probe(file) };
}
function assertPlayable(x, { w, h, frames = 300 } = {}) {
  const { info, file } = x;
  assert.equal(info.v.codec_name, 'h264'); assert.equal(info.a.codec_name, 'aac');
  if (w) { assert.equal(info.v.width, w); assert.equal(info.v.height, h); }
  assert.ok(Math.abs(info.duration - 12) < 0.3, `duration ${info.duration}`);
  assert.equal(info.frames, frames, 'all video frames present');
  assert.equal(decodeErrors(file), '', 'decodes without errors');
  // moov before mdat (faststart / seekable)
  const head = fs.readFileSync(file).subarray(0, 4096).toString('latin1');
  assert.ok(head.indexOf('moov') > 0 && head.indexOf('moov') < (fs.readFileSync(file).indexOf('mdat')), 'faststart layout');
}

test('analyze: HLS master lists qualities best first', async () => {
  const a = await analyzeManifest(`${S.base}/hls_ts/master.m3u8`);
  assert.equal(a.kind, 'hls'); assert.equal(a.options.length, 2);
  assert.equal(a.options[0].height, 360); assert.equal(a.options[1].height, 180);
  assert.ok(Math.abs(a.duration - 12) < 0.5 && a.live === false, 'duration read from the best variant');
});
test('analyze: DASH', async () => {
  const a = await analyzeManifest(`${S.base}/dash/manifest.mpd`);
  assert.equal(a.kind, 'dash'); assert.equal(a.options[0].height, 360); assert.equal(a.problem, null);
});

test('HLS MPEG-TS master -> best quality, single MP4 with audio', async () => {
  const x = await run(`${S.base}/hls_ts/master.m3u8`, '0');
  assertPlayable(x, { w: 640, h: 360 });
  assert.ok(x.progress.at(-1).done > 0);
});
test('HLS MPEG-TS master -> lowest quality selectable', async () => {
  const x = await run(`${S.base}/hls_ts/master.m3u8`, '1');
  assertPlayable(x, { w: 320, h: 180 });
});
test('HLS AES-128 encrypted segments', async () => {
  const x = await run(`${S.base}/hls_enc/index.m3u8`);
  assertPlayable(x, { w: 640, h: 360 });
});
test('HLS fMP4 with separate audio rendition is merged', async () => {
  const x = await run(`${S.base}/hls_fmp4/master.m3u8`);
  assertPlayable(x, { w: 640, h: 360 });
});
test('DASH separate audio/video fMP4 merged into one MP4', async () => {
  const x = await run(`${S.base}/dash/manifest.mpd`);
  assertPlayable(x, { w: 640, h: 360 });
});
test('A/V stay in sync (same offset as the source stream, <= 100 ms)', async () => {
  const x = await run(`${S.base}/hls_fmp4/master.m3u8`);
  assert.ok(Math.abs(+x.info.v.start_time - +x.info.a.start_time) <= 0.1, `${x.info.v.start_time} vs ${x.info.a.start_time}`);
});
test('failed segment -> clear error (no hang)', async () => {
  const bad = path.join(root, 'hls_ts', 'broken.m3u8');
  fs.writeFileSync(bad, '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nnope.ts\n#EXT-X-ENDLIST\n');
  await assert.rejects(downloadStream(`${S.base}/hls_ts/broken.m3u8`, { retries: 0 }), /HTTP 404/);
});
test('cancel via AbortSignal', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(downloadStream(`${S.base}/hls_ts/hi.m3u8`, { signal: ac.signal }), /Cancel/);
});

test('size limit: stops with SIZE_LIMIT, no limit by default', async () => {
  await assert.rejects(downloadStream(`${S.base}/hls_ts/hi.m3u8`, { maxBytes: 50_000 }), /SIZE_LIMIT/);
  const r = await downloadStream(`${S.base}/hls_ts/hi.m3u8`); // default: unlimited
  assert.ok(r.size > 50_000);
});
test('64-bit offsets (co64 + extended mdat, i.e. >4 GB files) produce a valid MP4', async () => {
  const r = await downloadStream(`${S.base}/hls_fmp4/master.m3u8`, { force64: true });
  const file = path.join(tmp, 'f64.mp4'); fs.writeFileSync(file, Buffer.from(await r.blob.arrayBuffer()));
  assert.ok(fs.readFileSync(file).includes('co64'));
  const info = probe(file); assert.equal(info.frames, 300); assert.equal(decodeErrors(file), '');
});
test('1-hour stream (108k video samples) – regression for "Maximum call stack size exceeded"', { skip: !fs.existsSync(path.join(root, 'hls_long', 'index.m3u8')) && 'run npm run fixtures:long' }, async () => {
  const x = await run(`${S.base}/hls_long/index.m3u8`);
  assert.equal(x.info.frames, 108000); assert.ok(Math.abs(x.info.duration - 3600) < 0.5);
  assert.equal(decodeErrors(x.file), '');
});

// ---- audio-only mode (M4A) ----
async function runAudio(url) {
  const r = await downloadStream(url, { mode: 'audio' });
  const file = path.join(tmp, `${Math.random().toString(36).slice(2)}.m4a`);
  fs.writeFileSync(file, Buffer.from(await r.blob.arrayBuffer()));
  return { file, info: probe(file), r };
}
for (const [name, url] of [['HLS fMP4 (separate audio rendition – never fetches video)', 'hls_fmp4/master.m3u8'], ['DASH (never fetches video segments)', 'dash/manifest.mpd'], ['HLS MPEG-TS (audio extracted from muxed TS)', 'hls_ts/master.m3u8']]) {
  test(`audio-only: ${name}`, async () => {
    const x = await runAudio(`${S.base}/${url}`);
    assert.equal(x.info.v, undefined, 'no video stream'); assert.equal(x.info.a.codec_name, 'aac');
    assert.ok(Math.abs(x.info.duration - 12) < 0.3, `duration ${x.info.duration}`);
    assert.equal(decodeErrors(x.file), '');
    assert.equal(x.r.blob.type, 'audio/mp4');
  });
}
test('audio-only skips video requests entirely (bandwidth saving)', async () => {
  const hits = []; const s2 = await serve(root, { onRequest: (r) => hits.push(r.url) });
  await downloadStream(`${s2.base}/dash/manifest.mpd`, { mode: 'audio' }); s2.close();
  assert.ok(hits.some((u) => /chunk-1-/.test(u)) && !hits.some((u) => /chunk-0-/.test(u)), hits.filter((u) => /chunk|init/.test(u)).join(','));
});

// ---- file name templates ----
import { formatName } from '../../src/core/naming.js';
test('naming: default template, placeholders, cleanup, sanitising', () => {
  assert.equal(formatName('{title} [{quality}]', { title: 'Aula: Hack4u', quality: '1080p' }, 'mp4'), 'Aula Hack4u [1080p].mp4');
  assert.equal(formatName('{title} [{quality}]', { title: 'X', quality: '' }, 'mp4'), 'X.mp4', 'empty quality removes its brackets');
  assert.equal(formatName('{site} - {title} ({quality}) {date}', { title: 'T', quality: '720p', site: 'a.com', dateObj: new Date(2026, 0, 5) }, 'm4a'), 'a.com - T (720p) 2026-01-05.m4a');
  assert.equal(formatName('', { title: 'Z' }, 'mp4'), 'Z.mp4');
  assert.ok(!/[\\/:*?"<>|]/.test(formatName('{title}', { title: 'a/b\\c:d*e?f"g<h>i|j' }, 'mp4')));
});
