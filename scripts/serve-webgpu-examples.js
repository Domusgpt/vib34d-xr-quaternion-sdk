#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
]);

const PORT = Number.parseInt(process.env.PORT ?? '4173', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const ROOT = resolve(process.cwd(), 'DOCS/examples');

async function readAsset(pathname) {
  const safePath = pathname.replace(/\.\.+/g, '.');
  const resolved = resolve(ROOT, safePath.slice(1) || 'index.html');
  const content = await readFile(resolved);
  const type = MIME_TYPES.get(extname(resolved).toLowerCase()) ?? 'application/octet-stream';
  return { content, type };
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  try {
    const { content, type } = await readAsset(new URL(req.url, `http://${req.headers.host}`).pathname);
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`WebGPU examples served from ${ROOT}`);
  console.log(`Listening on http://${HOST}:${PORT}`);
});
