'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactString, sanitize, MASK } = require('../lib/redact');

const SECRETS = [
  'STRIPE_SECRET_KEY=sk_live_51HabcdefGHIJKLmnop',
  'export ANTHROPIC_API_KEY="sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv"',
  'token ghp_0123456789abcdefghijABCDEFGHIJ012345',
  'aws AKIAIOSFODNN7EXAMPLE',
  'DATABASE_URL=postgres://admin:hunter2pass@db.example.com:5432/app',
  'Authorization: Bearer abcdefghijklmnop.qrstuvwx',
  'password: correcthorsebattery',
  '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----',
  'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
];

for (const s of SECRETS) {
  test(`masks: ${s.slice(0, 30)}`, () => {
    const out = redactString(s);
    assert.ok(out.includes(MASK), out);
    assert.ok(!out.includes('masqué] masqué]'), `double mask in ${out}`);
    for (const bad of ['sk_live_51', 'sk-ant-api03', 'ghp_0123', 'AKIAIOSF', 'hunter2pass', 'abcdefghijklmnop.qrst', 'correcthorse', 'b3BlbnNzaC1', 'dozjgNry']) {
      assert.ok(!out.includes(bad), `leaked ${bad} in ${out}`);
    }
  });
}

test('leaves ordinary text alone', () => {
  const s = 'npm run build && git commit -m "add login page"';
  assert.equal(redactString(s), s);
});

test('sanitize walks objects and truncates long strings', () => {
  const out = sanitize({ a: { b: ['API_KEY=abcdef123456'] }, long: 'x'.repeat(5000) }, 100);
  assert.ok(out.a.b[0].includes(MASK));
  assert.ok(out.long.length < 200);
});
