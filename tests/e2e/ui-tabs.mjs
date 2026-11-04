// Fast, focused UI regression: loads the built extension, detects a stream, and checks popup tab switching.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from '../helpers/server.mjs';
import { checkTabs } from '../helpers/tabs-check.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ext = path.join(root, 'dist', 'chrome');
const CHROME = process.env.CHROME_BIN || fs.readdirSync('/tmp/chr').map((d) => path.join('/tmp/chr', d, 'chrome')).find(fs.existsSync);
const www = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-www-')); fs.cpSync(path.join(root, 'tests', 'fixtures'), www, { recursive: true }); fs.cpSync(path.join(root, 'tests', 'site'), www, { recursive: true });
const S = await serve(www);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'p-')), args: ['--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run'] });
let code = 0;
try {
  const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js')); const id = new URL(sw.url()).host;
  const ctrl = await b.newPage(); await ctrl.goto(`chrome-extension://${id}/popup.html`);
  const page = await b.newPage(); await page.goto(`${S.base}/index.html`); await new Promise((r) => setTimeout(r, 2500));
  const tabId = await ctrl.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url.includes('/index.html'))?.id);
  const ui = await b.newPage(); await ui.setViewport({ width: 440, height: 580 });
  await ui.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`); await new Promise((r) => setTimeout(r, 1200));
  const r = await checkTabs(ui);
  console.log(r.ok ? 'PASS  tabs: one visible section at a time, no overlap/leaks' : `FAIL  tabs overlap — ${r.detail.slice(0, 600)}`);
  code = r.ok ? 0 : 1;
} catch (e) { console.log('FAIL', e.stack); code = 1; } finally { await b.close(); S.close(); }
process.exit(code);
