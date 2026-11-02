export const resolveUrl = (rel, base) => { try { return new URL(rel, base).href; } catch { return rel; } };

export class AbortError extends Error { constructor() { super('Cancelled'); this.name = 'AbortError'; } }

/** Fetch bytes with retries. opts: {fetch, signal, range:[start,end], retries} */
export async function fetchBytes(url, opts = {}) {
  const f = opts.fetch || globalThis.fetch.bind(globalThis);
  const retries = opts.retries ?? 3;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (opts.signal?.aborted) throw new AbortError();
    try {
      const headers = {};
      if (opts.range) headers.Range = `bytes=${opts.range[0]}-${opts.range[1]}`;
      const res = await f(url, { headers, signal: opts.signal, credentials: 'include', cache: 'no-store' });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
      let buf = new Uint8Array(await res.arrayBuffer());
      // Server ignored Range and sent the whole file: slice it.
      if (opts.range && res.status === 200) buf = buf.subarray(opts.range[0], opts.range[1] + 1);
      return buf;
    } catch (e) {
      if (opts.signal?.aborted || e.name === 'AbortError') throw new AbortError();
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw lastErr;
}
export const fetchText = async (url, opts) => new TextDecoder().decode(await fetchBytes(url, opts));

/**
 * Fetch many resources concurrently but yield results IN ORDER, keeping at most
 * `window` results buffered (bounded memory, ordered consumption).
 * tasks: array of () => Promise<T>
 */
export async function* orderedPool(tasks, concurrency = 6, signal) {
  const results = new Map();
  let next = 0, inflight = 0, consumed = 0, failure;
  const waiters = [];
  const wake = () => { while (waiters.length) waiters.shift()(); };
  const pump = () => {
    while (!failure && inflight < concurrency && next < tasks.length && next - consumed < concurrency * 2) {
      const i = next++; inflight++;
      tasks[i]().then((v) => results.set(i, v), (e) => { failure = failure || e; })
        .finally(() => { inflight--; pump(); wake(); });
    }
  };
  pump();
  for (let i = 0; i < tasks.length; i++) {
    while (!results.has(i)) {
      if (failure) throw failure;
      if (signal?.aborted) throw new AbortError();
      await new Promise((r) => waiters.push(r));
    }
    const v = results.get(i); results.delete(i); consumed = i + 1;
    pump();
    yield v;
  }
}

export const sanitizeFilename = (s, fallback = 'video') =>
  (String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)) || fallback;
