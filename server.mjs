/**
 * server.mjs — SERVIDOR DE COLABORACIÓN (Node.js, SIN dependencias)
 * ----------------------------------------------------------------------------
 * Ejecutar:  node server.mjs        (o: npm start)
 * Abrir:     http://localhost:3000
 *
 * Qué hace:
 *  1) Sirve la carpeta /public (la aplicación web).
 *  2) Expone una API mínima para que VARIOS dispositivos compartan la historia:
 *       GET  /api/ping              → comprueba que hay servidor
 *       GET  /api/state?since=REV   → devuelve el estado (o {unchanged:true})
 *       POST /api/ops  {ops:[...]}  → aplica operaciones y responde resultados
 *  3) Guarda todo en data/db.json (persistencia simple en archivo).
 *
 * Las reglas (versiones, conflictos) vienen de public/js/model.js: el mismo
 * código que usa el navegador. El servidor es la "fuente de verdad".
 */
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOp } from './public/js/model.js';
import { seedState } from './public/js/seed.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT) || 3000;
// HTTPS opcional (necesario para cámara/GPS en el celular). Se activa si existe
// cert/dev.pfx, que se crea con scripts/crear-certificado.ps1.
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const CERT_FILE = path.join(ROOT, 'cert', 'dev.pfx');
const CERT_PASS = process.env.CERT_PASS || 'mapa';
let httpsOn = false;
const MAX_BODY = 15 * 1024 * 1024; // 15 MB (fotos/audios van en base64)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

// ---------------------------------------------------------------- Persistencia
let state;

async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(DB_FILE)) {
    try {
      state = JSON.parse(await readFile(DB_FILE, 'utf8'));
      console.log(`✔ Datos cargados de ${DB_FILE} (rev ${state.rev})`);
      return;
    } catch (e) {
      console.warn('⚠ db.json dañado; se crea uno nuevo con datos de demo.', e.message);
    }
  }
  state = seedState();
  await saveNow();
  console.log('✔ Base de datos nueva con la historia de demostración.');
}

// Escritura "atómica": primero a un temporal y luego se renombra, para no
// dejar el archivo a medias si el proceso se corta.
async function saveNow() {
  const tmp = DB_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, DB_FILE);
}

// Agrupa escrituras seguidas (si llegan 5 ops en 1 s, se escribe una vez).
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow().catch(e => console.error('Error guardando:', e)), 300);
}

// ------------------------------------------------------------------ Utilidades
/**
 * IP de esta PC en la red local (Wi-Fi/Ethernet), para que los QR generados
 * desde "localhost" apunten a una dirección que el celular sí pueda abrir.
 * Se ignoran adaptadores virtuales (VMware, VirtualBox, Hyper-V, WSL, Docker).
 */
function lanAddress() {
  const skip = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|docker|loopback|bluetooth/i;
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.') || a.address.startsWith('192.168.56.')) continue;
      found.push({ name, address: a.address });
    }
  }
  const wifi = found.find(f => /wi-?fi|wlan|wireless/i.test(f.name));
  return (wifi || found[0])?.address || null;
}

// Dirección que se pone dentro de los QR. Se puede forzar con PUBLIC_URL
// (por ejemplo, la URL HTTPS de un túnel).
function publicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const ip = lanAddress();
  if (!ip) return null;
  return httpsOn ? `https://${ip}:${HTTPS_PORT}` : `http://${ip}:${PORT}`;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('demasiado-grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  // Evita salir de /public con rutas tipo "/../server.mjs".
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('no es archivo');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}

// ----------------------------------------------------------------------- API
async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/ping') return sendJson(res, 200, { ok: true, rev: state.rev, publicUrl: publicUrl() });

    if (url.pathname === '/api/state' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since'));
      // Si el cliente ya tiene la última revisión, no se reenvía todo (ahorra datos móviles).
      if (Number.isFinite(since) && since === state.rev) return sendJson(res, 200, { unchanged: true, rev: state.rev });
      return sendJson(res, 200, { state });
    }

    if (url.pathname === '/api/ops' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const ops = Array.isArray(body.ops) ? body.ops : [];
      // Se aplican en orden. Cada op devuelve su propio resultado (ok / error / conflicto).
      const results = ops.map(op => ({ id: op.id, ...applyOp(state, op) }));
      if (results.some(r => r.ok)) scheduleSave();
      return sendJson(res, 200, { results, rev: state.rev, state });
    }

    if (url.pathname === '/api/reset' && req.method === 'POST') {
      state = seedState();
      await saveNow();
      return sendJson(res, 200, { ok: true, state });
    }

    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'no-existe' });
    return serveStatic(req, res);
  } catch (e) {
    console.error(e);
    return sendJson(res, e.message === 'demasiado-grande' ? 413 : 400, { ok: false, error: e.message });
  }
}

await loadState();

// HTTPS (si hay certificado): mismo manejador, otro puerto.
if (existsSync(CERT_FILE)) {
  try {
    const httpsServer = https.createServer({ pfx: await readFile(CERT_FILE), passphrase: CERT_PASS }, handler);
    await new Promise((resolve, reject) => { httpsServer.once('error', reject); httpsServer.listen(HTTPS_PORT, resolve); });
    httpsOn = true;
  } catch (e) {
    console.warn(`⚠ No se pudo iniciar HTTPS (${e.message}). Vuelve a crear el certificado con scripts\\crear-certificado.ps1`);
  }
}

http.createServer(handler).listen(PORT, () => {
  console.log(`\n📍 Mapa de Relatos listo en http://localhost:${PORT}`);
  const lan = publicUrl();
  if (lan) console.log(`   Desde el celular (misma red Wi-Fi): ${lan}`);
  else console.log('   Otros dispositivos de la misma red Wi-Fi pueden entrar con la IP de esta PC.');
  if (httpsOn) console.log('   (Certificado autofirmado: en el celular toca "Avanzado" → "Continuar" la primera vez.)\n');
  else console.log('   Cámara y GPS en el celular requieren HTTPS: ejecuta scripts\\crear-certificado.ps1 y reinicia.\n');
});
