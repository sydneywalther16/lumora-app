import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.env.PORT ?? 8787);
const root = resolve('dist');
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getFilePath(pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const normalizedPath = normalize(requestedPath).replace(/^([.][.][\\/])+/, '');
  const filePath = join(root, normalizedPath);

  if (!filePath.startsWith(root)) return join(root, 'index.html');
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) return join(root, 'index.html');
  return filePath;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'lumora-preview' });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 503, {
      error: 'Preview server is running; install dependencies and start the API for full backend routes.',
    });
    return;
  }

  const filePath = getFilePath(url.pathname);
  const contentType = mimeTypes.get(extname(filePath)) ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Lumora preview listening on http://localhost:${port}`);
});
