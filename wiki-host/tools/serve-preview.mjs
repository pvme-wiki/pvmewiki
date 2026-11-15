import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 4179);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try { const bytes = fs.readFileSync(target); response.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }); response.end(bytes); }
  catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + port));
