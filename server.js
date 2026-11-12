// Aubrion Relay — крошечный сервер-посредник между веб-панелью и магнитолой.
// Без внешних зависимостей (чистый Node). Хранит очередь команд и статус в памяти.
//
// Запуск:  RELAY_SECRET=мойсекрет PORT=8080 node server.js
//
// API:
//   GET  /api/poll?key=SECRET&car=ID        — магнитола ждёт команду (long-poll ~25с)
//   POST /api/status  {key,car,online,lat,lon,note}  — магнитола шлёт статус/локацию
//   POST /api/cmd     {key,car,action}       — панель кладёт команду
//   GET  /api/state?key=SECRET&car=ID        — панель читает статус/локацию
//   GET  /                                   — веб-панель

const http = require('http');
const fs   = require('fs');
const path = require('path');

const SECRET = process.env.RELAY_SECRET || 'aubrion';
const PORT   = process.env.PORT || 8080;

// состояние по машинам: carId -> {queue, waiters, status, location, lastSeen}
const cars = new Map();
function car(id) {
  if (!cars.has(id)) cars.set(id, { queue: [], waiters: [], status: null, location: null, lastSeen: 0 });
  return cars.get(id);
}

const ALLOWED = new Set([
  'ac_on','ac_off','heat_on','heat_off','temp_up','temp_down',
  'win_open','win_close','win_half','loc','status'
]);

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(body);
}
function readBody(req) {
  return new Promise(resolve => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }

  // --- магнитола ждёт команду ---
  if (p === '/api/poll' && req.method === 'GET') {
    if (u.searchParams.get('key') !== SECRET) return send(res, 403, { error: 'bad key' });
    const c = car(u.searchParams.get('car') || 'default');
    c.lastSeen = Date.now();
    if (c.queue.length) return send(res, 200, { cmd: c.queue.shift() });
    // держим до 25 секунд, пока не прилетит команда
    const t = setTimeout(() => {
      c.waiters = c.waiters.filter(w => w !== waiter);
      send(res, 200, { cmd: null });
    }, 25000);
    const waiter = (cmd) => { clearTimeout(t); send(res, 200, { cmd }); };
    c.waiters.push(waiter);
    req.on('close', () => { clearTimeout(t); c.waiters = c.waiters.filter(w => w !== waiter); });
    return;
  }

  // --- магнитола шлёт статус/локацию ---
  if (p === '/api/status' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.key !== SECRET) return send(res, 403, { error: 'bad key' });
    const c = car(b.car || 'default');
    c.lastSeen = Date.now();
    if (b.note !== undefined) c.status = { note: b.note, t: Date.now() };
    if (typeof b.lat === 'number' && typeof b.lon === 'number')
      c.location = { lat: b.lat, lon: b.lon, t: Date.now() };
    return send(res, 200, { ok: true });
  }

  // --- панель кладёт команду ---
  if (p === '/api/cmd' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.key !== SECRET) return send(res, 403, { error: 'bad key' });
    if (!ALLOWED.has(b.action)) return send(res, 400, { error: 'bad action' });
    const c = car(b.car || 'default');
    if (c.waiters.length) c.waiters.shift()(b.action);   // отдать ждущей магнитоле сразу
    else c.queue.push(b.action);                          // иначе в очередь
    return send(res, 200, { ok: true });
  }

  // --- панель читает статус ---
  if (p === '/api/state' && req.method === 'GET') {
    if (u.searchParams.get('key') !== SECRET) return send(res, 403, { error: 'bad key' });
    const c = car(u.searchParams.get('car') || 'default');
    const online = Date.now() - c.lastSeen < 40000;
    return send(res, 200, { online, lastSeen: c.lastSeen, status: c.status, location: c.location });
  }

  // --- веб-панель ---
  if (p === '/' || p === '/index.html') {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, data) => {
      if (e) { res.writeHead(500); res.end('no panel'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log('Aubrion relay on :' + PORT + '  secret=' + SECRET));
