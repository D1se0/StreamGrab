import { sanitizeFilename } from './util.js';

export const DEFAULT_TEMPLATE = '{title} [{quality}]';
const pad = (n) => String(n).padStart(2, '0');

/**
 * Builds a file name from a template. Placeholders: {title} {quality} {site} {date} {time} {kind}
 * Empty placeholders vanish together with their surrounding brackets/separators.
 */
export function formatName(template, vars, ext) {
  const d = vars.dateObj || new Date();
  const v = { title: vars.title || '', quality: vars.quality || '', site: vars.site || '', kind: vars.kind || '',
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}-${pad(d.getMinutes())}` };
  let out = String(template || DEFAULT_TEMPLATE).replace(/\{(title|quality|site|date|time|kind)\}/g, (_m, k) => v[k]);
  out = out.replace(/\[\s*\]|\(\s*\)/g, '').replace(/\s*[-–_]\s*(?=[-–_]|$)/g, '').replace(/^\s*[-–_]\s*/, '');
  out = sanitizeFilename(out, v.title || v.site || 'video');
  return `${out}.${ext}`;
}
