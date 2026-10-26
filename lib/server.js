'use strict';
// Local dashboard server. Node standard library only.
// Security: listens on 127.0.0.1 only, rejects any Host header that is not localhost
// (blocks DNS-rebinding attacks from web pages), sends no CORS headers, strict CSP.

const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { summarise } = require('./session');
const { usageFromTranscript } = require('./transcript');
const pkg = require('../package.json');

const UI_FILE = path.join(__dirname, '..', 'ui', 'index.html');

function allowedHost(host, port) {
  if (!host) return false;
  const h = host.toLowerCase();
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(h);
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function sessionList(home, limit = 60) {
  const out = [];
  for (const f of store.listSessionFiles(home).slice(0, limit)) {
    const records = store.readSession(home, f.id);
    if (!records.length) continue;
    const s = summarise(f.id, records);
    delete s.files;
    out.push(s);
  }
  return out;
}

function createServer(cfg, { log = () => {} } = {}) {
  const clients = new Set();
  let stopFollow = null;

  const server = http.createServer((req, res) => {
    const port = server.address() && server.address().port;
    if (!allowedHost(req.headers.host, port)) return send(res, 403, { error: 'host not allowed' });
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (p === '/' || p === '/index.html') {
      let html;
      try {
        html = fs.readFileSync(UI_FILE);
      } catch {
        return send(res, 500, 'UI missing', 'text/plain; charset=utf-8');
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      return res.end(html);
    }
    if (p === '/api/health') return send(res, 200, { ok: true, app: 'vigie', version: pkg.version, lang: cfg.lang, guard: cfg.guard, guardLevel: cfg.guardLevel });
    if (p === '/api/sessions') return send(res, 200, { sessions: sessionList(cfg.home) });
    const m = p.match(/^\/api\/sessions\/([A-Za-z0-9_-]{1,80})(\/usage)?$/);
    if (m) {
      const id = m[1];
      const records = store.readSession(cfg.home, id);
      if (!records.length) return send(res, 404, { error: 'unknown session' });
      const summary = summarise(id, records);
      if (m[2]) return send(res, 200, { usage: usageFromTranscript(summary.transcript) });
      return send(res, 200, { summary, records });
    }
    if (p === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 2000\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    return send(res, 404, { error: 'not found' });
  });

  let heartbeat = null;

  server.on('listening', () => {
    heartbeat = setInterval(() => {
      for (const c of clients) c.write(`: ping\n\n`);
    }, 15000);
    stopFollow = store.follow(cfg.home, (rec) => {
      const data = `data: ${JSON.stringify(rec)}\n\n`;
      for (const c of clients) c.write(data);
    });
    log(`listening on ${server.address().port}`);
  });
  // Track sockets so close() really stops everything (SSE and keep-alive connections included).
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  const close = server.close.bind(server);
  server.close = (cb) => {
    clearInterval(heartbeat);
    if (stopFollow) stopFollow();
    stopFollow = null;
    for (const c of clients) c.end();
    clients.clear();
    for (const s of sockets) s.destroy();
    return close(cb);
  };
  return server;
}

/** Start on cfg.port, or the next free port. Resolves with the bound port. */
function start(cfg, opts = {}) {
  return new Promise((resolve, reject) => {
    let port = cfg.port;
    const tryListen = () => {
      const server = createServer(cfg, opts);
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < cfg.port + 10) {
          port++;
          tryListen();
        } else reject(err);
      });
      server.listen(port, '127.0.0.1', () => resolve({ server, port }));
    };
    tryListen();
  });
}

module.exports = { start, createServer, allowedHost, sessionList };
