// Servidor local para probar la app sin Vercel: sirve los archivos y las funciones de /api.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PUERTO = Number(process.env.PORT) || 3000;
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function adaptarRes(res) {
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (o) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(o));
  };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let cuerpo = '';
    for await (const trozo of req) cuerpo += trozo;
    req.body = cuerpo ? JSON.parse(cuerpo) : {};
    const mod = await import(`../api/${path.basename(url.pathname)}.js?t=${Date.now()}`);
    return mod.default(req, adaptarRes(res));
  }
  const ruta = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const contenido = await readFile(path.join(process.cwd(), path.normalize(ruta)));
    res.setHeader('Content-Type', TIPOS[path.extname(ruta)] || 'application/octet-stream');
    res.end(contenido);
  } catch {
    res.statusCode = 404;
    res.end('No encontrado');
  }
}).listen(PUERTO, () => console.log(`http://localhost:${PUERTO}`));
