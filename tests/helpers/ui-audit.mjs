// In-page design audit for the popup: overflow, clipped text, spill-out, tap-target size, WCAG contrast. Returns a list of issues.
export const AUDIT_SOURCE = `(() => {
  const issues = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const path = (e) => { const p = []; for (let x = e; x && x !== document.body && p.length < 4; x = x.parentElement) p.unshift(x.tagName.toLowerCase() + (x.className && typeof x.className === 'string' ? '.' + x.className.trim().split(/\\s+/)[0] : '')); return p.join('>'); };
  const parse = (s) => { let m = s.match(/^rgba?\\(([^)]+)\\)/); if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = s.match(/^color\\(srgb ([^)]+)\\)/); if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; } return null; };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const chain = (e) => { const c = []; for (let x = e; x; x = x.parentElement) c.unshift(x); return c; };
  // candidate backgrounds (several when a gradient is involved -> worst case is checked)
  const bgs = (e) => { let cands = [[255, 255, 255, 1]]; const root = parse(getComputedStyle(document.documentElement).backgroundColor); if (root && root[3] > 0) cands = [over(root, [255, 255, 255, 1])];
    for (const x of chain(e)) { const cs = getComputedStyle(x); const bc = parse(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) { const stops = [...cs.backgroundImage.matchAll(/rgba?\\([^)]+\\)/g)].map((m) => parse(m[0])).filter((c) => c && c[3] > 0.5); if (stops.length) { cands = stops.map((s) => over(s, cands[0])); continue; } }
      if (bc && bc[3] > 0) cands = cands.map((c) => over(bc, c)); }
    return cands; };
  const opacity = (e) => chain(e).reduce((a, x) => a * parseFloat(getComputedStyle(x).opacity), 1);
  const insideDisabled = (e) => !!e.closest('button:disabled');

  const main = document.querySelector('main');
  if (document.documentElement.scrollWidth > 440 + 1) issues.push('page scrolls horizontally: ' + document.documentElement.scrollWidth);
  if (main.scrollWidth > main.clientWidth + 1) issues.push('main scrolls horizontally: ' + main.scrollWidth + ' > ' + main.clientWidth);

  const all = [...document.querySelectorAll('body *')].filter((e) => vis(e) && !e.closest('[hidden]') && !(e instanceof SVGElement && e.tagName !== 'svg'));
  for (const e of all) {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (opacity(e) === 0) continue;
    if (!e.closest('.hacts') && e.tagName !== 'OPTION' && (r.right > 440.5 || r.left < -0.5)) issues.push('outside viewport: ' + path(e) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
    // clipped text without ellipsis / line clamp
    if (e.children.length === 0 && e.textContent.trim() && cs.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && !cs.webkitLineClamp.match(/\\d/)) issues.push('text clipped without ellipsis: ' + path(e) + ' "' + e.textContent.trim().slice(0, 30) + '"');
    // text overflowing a box that does not clip it (spills over neighbours)
    if (e.children.length === 0 && e.textContent.trim() && cs.overflowX === 'visible' && cs.display !== 'inline' && e.scrollWidth > e.clientWidth + 1) issues.push('text overflows its box: ' + path(e) + ' "' + e.textContent.trim().slice(0, 30) + '"');
    // text/ellipsis lines inside clamped boxes must actually fit the box height
    // children spilling out of a non-clipping parent
    if (cs.overflowX === 'visible' && !e.closest('.hacts') && e.tagName !== 'svg' && cs.display !== 'inline') for (const c of e.children) { const cr = c.getBoundingClientRect(); const pos = getComputedStyle(c).position; if (!vis(c) || pos === 'absolute' || pos === 'fixed' || c instanceof SVGElement) continue; if (cr.right > r.right + 1.5 || cr.left < r.left - 1.5) issues.push('child spills out of parent: ' + path(c) + ' in ' + path(e)); }
    // tap targets
    if ((e.tagName === 'BUTTON' || e.tagName === 'SELECT' || (e.tagName === 'INPUT' && e.type !== 'checkbox')) && !e.closest('.hacts')) { if (r.height < 26 || r.width < 26) issues.push('target too small ' + Math.round(r.width) + 'x' + Math.round(r.height) + ': ' + path(e)); }
    if (e.tagName === 'INPUT' && e.type === 'checkbox' && (r.width < 36 || r.height < 22)) issues.push('toggle too small: ' + path(e));
    // contrast
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || ((e.tagName === 'INPUT' && e.type !== 'checkbox' && (e.value || '').length > 0) || e.tagName === 'SELECT');
    if (hasText && !insideDisabled(e) && e.tagName !== 'OPTION') {
      const fg0 = parse(cs.color); if (!fg0) continue; const op = opacity(e); const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5; const dim = e.closest('.gone') ? 3 : need;
      let worst = 99; for (const bg of bgs(e)) { const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg); worst = Math.min(worst, ratio(fg, bg)); }
      if (worst < dim) issues.push('low contrast ' + worst.toFixed(2) + ' (<' + dim + '): ' + path(e) + ' "' + (e.textContent || e.value || '').trim().slice(0, 24) + '"');
    }
    if (e.tagName === 'svg' && e.closest('button.ic') && !insideDisabled(e)) { const fg = parse(cs.color); let worst = 99; for (const bg of bgs(e)) worst = Math.min(worst, ratio(over([fg[0], fg[1], fg[2], fg[3] * opacity(e)], bg), bg)); if (worst < 3) issues.push('icon contrast ' + worst.toFixed(2) + ': ' + path(e)); }
  }
  // flex children that are cut off silently (overflow hidden, no ellipsis, wider than the box)
  for (const e of document.querySelectorAll('.card *, .h *, .s *, .box *')) { const cs = getComputedStyle(e); if (!vis(e) || e.closest('.hacts')) continue; if (cs.overflowX === 'hidden' && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && !(cs.webkitLineClamp || '').match(/\\d/) && e.tagName !== 'IMG' && !e.matches('.thumb, .tile, .bar, .skel i, .sw i')) issues.push('content cut off silently: ' + path(e)); }
  // sibling overlap inside lists
  for (const list of document.querySelectorAll('#list, #hlist')) { const kids = [...list.children].filter(vis).map((k) => k.getBoundingClientRect()); for (let i = 0; i < kids.length - 1; i++) if (kids[i].bottom > kids[i + 1].top + 1) issues.push('siblings overlap in ' + list.id); }
  return issues;
})()`;
