// Minimal dependency-free XML parser (enough for DASH MPD). Works in Node, workers and service workers
// (DOMParser is not available in service workers, so we cannot rely on it).
const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
const unescapeXml = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, _n, d, h) =>
    ENT[m] || String.fromCodePoint(d ? parseInt(d, 10) : parseInt(h, 16)));

export function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const el = { name: m[3].replace(/^.*:/, ''), attrs: {}, children: [], text: '' };
      const ar = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
      let a;
      while ((a = ar.exec(m[4] || ''))) el.attrs[a[1].replace(/^.*:/, '')] = unescapeXml(a[2] ?? a[3] ?? '');
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.text += unescapeXml(m[6]);
  }
  return root.children[0];
}
export const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
export const kid = (el, name) => kids(el, name)[0];
