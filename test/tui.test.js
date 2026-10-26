'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRenderer } = require('../lib/tui');
const { buildRecord, guardOutput } = require('../lib/record');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'real-session.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('terminal view renders the whole session without crashing, in both languages and ASCII', () => {
  for (const lang of ['fr', 'en']) {
    for (const ascii of [false, true]) {
      let out = '';
      const r = createRenderer({ lang, color: false, ascii, write: (s) => (out += s), width: 100 });
      for (const p of FIXTURE) {
        const rec = buildRecord(p);
        guardOutput(rec, { lang, guard: 'ask', guardLevel: 'high' });
        r.render(rec);
      }
      assert.ok(out.length > 500);
      assert.doesNotMatch(out, /undefined|\[object Object\]/);
      if (lang === 'fr') assert.match(out, /RISQUE CRITIQUE/);
      if (lang === 'fr') assert.match(out, /Vigie te demande de confirmer/);
      if (ascii) assert.doesNotMatch(out, /[📖⚡✅]/u);
    }
  }
});
