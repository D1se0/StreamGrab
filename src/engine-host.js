// Runs downloads. Lives in the Chrome offscreen document, or directly in Firefox's background page.
import { downloadStream } from './core/download.js';

const jobs = new Map();
export async function startJob({ jobId, url, kind, optionId, concurrency, maxBytes }, emit) {
  const ac = new AbortController(); jobs.set(jobId, ac);
  let last = 0;
  try {
    const r = await downloadStream(url, {
      kind, optionId, concurrency, maxBytes, signal: ac.signal,
      onProgress: (p) => { const n = Date.now(); if (n - last > 250 || p.phase === 'mux') { last = n; emit({ type: 'progress', jobId, ...p }); } },
    });
    emit({ type: 'done', jobId, blobUrl: URL.createObjectURL(r.blob), size: r.size, duration: r.duration });
  } catch (e) {
    emit(e?.name === 'AbortError' ? { type: 'cancelled', jobId } : { type: 'error', jobId, message: String(e?.message || e) });
  } finally { jobs.delete(jobId); }
}
export const cancelJob = (jobId) => jobs.get(jobId)?.abort();
export const revoke = (url) => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } };
