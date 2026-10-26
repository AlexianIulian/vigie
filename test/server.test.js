'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { start } = require('../lib/server');
const store = require('../lib/store');
const { buildRecord } = require('../lib/record');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'real-session.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

function get(port, p, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { Host: host } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', reject);
  });
}

test('dashboard server: API, security headers, DNS-rebinding protection, live stream', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-srv-'));
  FIXTURE.slice(0, 20).forEach((p, i) => store.append(home, buildRecord(p, Date.now() - 20000 + i * 100)));
  const { server, port } = await start({ home, port: 47456, lang: 'fr', guard: 'ask', guardLevel: 'high' });
  try {
    const root = await get(port, '/');
    assert.equal(root.status, 200);
    assert.match(root.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(root.headers['x-frame-options'], 'DENY');
    assert.match(root.body, /<title>Vigie<\/title>/);

    const list = JSON.parse((await get(port, '/api/sessions')).body);
    assert.equal(list.sessions.length, 1);
    assert.equal(list.sessions[0].id, 'demo-session-0001');
    assert.equal(list.sessions[0].project, 'demo-proj');

    const one = JSON.parse((await get(port, '/api/sessions/demo-session-0001')).body);
    assert.equal(one.records.length, 20);

    assert.equal((await get(port, '/api/sessions/does-not-exist')).status, 404);
    assert.equal((await get(port, '/api/sessions/..%2F..%2Fetc')).status, 404);

    // A web page that rebinds its domain to 127.0.0.1 sends its own Host header: refused.
    assert.equal((await get(port, '/api/sessions', 'evil.example.com')).status, 403);
    assert.equal((await get(port, '/', `attacker.test:${port}`)).status, 403);
    assert.equal((await get(port, '/api/health', `localhost:${port}`)).status, 200);

    // No CORS: other origins cannot read responses.
    assert.equal(root.headers['access-control-allow-origin'], undefined);

    // Live stream receives a record appended after connecting.
    const received = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/stream', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
        let b = '';
        res.on('data', (c) => {
          b += c;
          const m = b.match(/data: (.+)\n\n/);
          if (m) {
            req.destroy();
            resolve(JSON.parse(m[1]));
          }
        });
      });
      req.on('error', () => {});
      setTimeout(() => store.append(home, buildRecord(FIXTURE[25], Date.now())), 400);
      setTimeout(() => reject(new Error('no live event')), 4000);
    });
    assert.equal(received.session, 'demo-session-0001');
  } finally {
    server.close();
  }
});

test('server only listens on loopback', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-srv-'));
  const { server } = await start({ home, port: 47470, lang: 'fr', guard: 'ask', guardLevel: 'high' });
  try {
    assert.equal(server.address().address, '127.0.0.1');
  } finally {
    server.close();
  }
});
