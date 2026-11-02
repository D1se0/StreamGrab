// Chrome offscreen document entry: receives commands from the service worker.
import { startJob, cancelJob, revoke } from './engine-host.js';
const api = globalThis.chrome;
const emit = (m) => api.runtime.sendMessage({ target: 'bg', ...m });
api.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'engine') return;
  if (msg.type === 'start') startJob(msg.job, emit);
  else if (msg.type === 'cancel') cancelJob(msg.jobId);
  else if (msg.type === 'revoke') revoke(msg.url);
});
