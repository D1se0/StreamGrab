import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const MIME = { '.m3u8': 'application/vnd.apple.mpegurl', '.mpd': 'application/dash+xml', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.html': 'text/html', '.js': 'text/javascript' };
export function serve(root, { port = 0, onRequest, routes = {} } = {}) {
  const srv = http.createServer((req, res) => {
    onRequest?.(req);
    const pn = new URL(req.url, 'http://x').pathname;
    if (routes[pn]) return routes[pn](req, res);
    // /protected/* only answers when the Referer comes from the same origin (hotlink protection)
    if (pn.startsWith('/protected/') && !(req.headers.referer || '').startsWith(`http://${req.headers.host}/`)) { res.writeHead(403); return res.end('forbidden'); }
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    const size = fs.statSync(p).size; const type = MIME[path.extname(p)] || 'application/octet-stream';
    const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const s = +range[1], e = range[2] ? +range[2] : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 });
      fs.createReadStream(p, { start: s, end: e }).pipe(res);
    } else { res.writeHead(200, { 'Content-Type': type, 'Content-Length': size }); fs.createReadStream(p).pipe(res); }
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, port: srv.address().port, base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}
