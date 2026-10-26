'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildRecord, guardOutput } = require('../lib/record');
const { summarise } = require('../lib/session');

// Real payloads captured from Claude Code 2.1.310, paths anonymised, plus risky actions.
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'real-session.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const CFG = { lang: 'fr', guard: 'ask', guardLevel: 'high' };

test('every real payload becomes a record with a bilingual title', () => {
  for (const p of FIXTURE) {
    const r = buildRecord(p);
    assert.equal(r.event, p.hook_event_name);
    if (['PostToolBatch'].includes(r.event)) continue;
    assert.ok(r.title && r.title.fr && r.title.en, `${r.event} ${r.tool || ''} has a title`);
  }
});

test('narration of the real session reads naturally', () => {
  const titles = FIXTURE.filter((p) => p.hook_event_name === 'PreToolUse').map((p) => buildRecord(p).title.fr);
  assert.ok(titles.includes('Lit README.md'), titles.join(' | '));
  assert.ok(titles.includes('Liste les fichiers du dossier'));
  assert.ok(titles.some((t) => t.startsWith('Cherche « TODO »')));
  assert.ok(titles.includes('Écrit le fichier notes.txt'));
  assert.ok(titles.includes('Modifie notes.txt'));
  assert.ok(titles.some((t) => t.startsWith('Confie une tâche à un sous-agent (general-purpose)')));
});

test('results and failures are described', () => {
  const read = buildRecord(FIXTURE.find((p) => p.hook_event_name === 'PostToolUse' && p.tool_name === 'Read'));
  assert.equal(read.result.fr, '3 lignes lues');
  const edit = buildRecord(FIXTURE.find((p) => p.hook_event_name === 'PostToolUse' && p.tool_name === 'Edit' && p.tool_input.new_string === 'bonjour'));
  assert.equal(edit.result.fr, '+1 / −1 lignes');
  const fail = buildRecord(FIXTURE.find((p) => p.hook_event_name === 'PostToolUseFailure' && p.tool_name === 'Read'));
  assert.match(fail.result.fr, /^Échec : File does not exist/);
});

test('subagent calls carry the agent identity', () => {
  const sub = FIXTURE.find((p) => p.hook_event_name === 'PreToolUse' && p.agent_id);
  assert.equal(buildRecord(sub).agent.type, 'general-purpose');
});

test('secrets printed by a command never reach the store', () => {
  const p = FIXTURE.find((x) => x.hook_event_name === 'PostToolUse' && x.tool_input && x.tool_input.command === 'cat .env');
  const r = buildRecord(p);
  assert.ok(!JSON.stringify(r).includes('sk_live_xxx') || JSON.stringify(r).includes('[secret masqué]'));
  assert.ok(!/STRIPE_SECRET_KEY=sk_live/.test(JSON.stringify(r)));
});

test('guard asks with a plain-language reason, in the exact shape Claude Code expects', () => {
  const p = FIXTURE.find((x) => x.hook_event_name === 'PreToolUse' && x.tool_input && x.tool_input.command === 'cat .env');
  const r = buildRecord(p);
  const out = guardOutput(r, CFG);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^Vigie — risque élevé : Affiche le contenu de \.env\./);
  assert.equal(r.guard.decision, 'ask');
});

test('guard is silent on safe actions, off mode, and below the threshold', () => {
  const safe = buildRecord(FIXTURE.find((x) => x.hook_event_name === 'PreToolUse' && x.tool_name === 'Read'));
  assert.equal(guardOutput(safe, CFG), null);
  const risky = buildRecord(FIXTURE.find((x) => x.hook_event_name === 'PreToolUse' && x.tool_input && x.tool_input.command === 'cat .env'));
  assert.equal(guardOutput(risky, { ...CFG, guard: 'off' }), null);
  assert.equal(guardOutput(risky, { ...CFG, guardLevel: 'critical' }), null);
  const medium = buildRecord(FIXTURE.find((x) => x.hook_event_name === 'PreToolUse' && x.tool_input && x.tool_input.command === 'rm -rf node_modules dist'));
  assert.equal(guardOutput(medium, CFG), null);
});

test('deny mode tells Claude what to do instead', () => {
  const r = buildRecord(FIXTURE.find((x) => x.hook_event_name === 'PreToolUse' && x.tool_input && /curl .*\| sh/.test(x.tool_input.command || '')));
  const out = guardOutput(r, { lang: 'en', guard: 'deny', guardLevel: 'high' });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Ask the user for explicit confirmation first/);
});

test('session summary counts the real session correctly', () => {
  const recs = FIXTURE.map((p, i) => buildRecord(p, 1000 + i));
  const s = summarise('demo', recs, 1000 + recs.length);
  assert.equal(s.counts.prompts, 2); // the <task-notification> prompt is not counted as a request
  assert.equal(s.counts.reads, 2);
  assert.equal(s.counts.edits, 3);
  assert.equal(s.counts.failures, 2);
  assert.equal(s.maxRisk, 'critical');
  assert.ok(s.files.find((f) => f.display === 'notes.txt' && f.created));
  assert.equal(s.status, 'ended');
});

test('secrets never leak through narration, steps, prompts or errors', () => {
  const base = { session_id: 's', cwd: '/p', prompt_id: 'x', tool_use_id: 't' };
  const recs = [
    buildRecord({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'use my key sk-ant-api03-SECRETSECRETSECRET123' }),
    buildRecord({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer ' + 'abcdefghijklmnopqrstuv" https://api.x.com', description: 'call with token ghp_' + '0123456789abcdefghijABCDEFGHIJ012345' } }),
    buildRecord({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'cat .env' }, tool_response: { stdout: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz' } }),
    buildRecord({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' }, error: 'bad password=hunter2hunter2' }),
    buildRecord({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/.env', old_string: 'STRIPE_KEY=sk_live_' + 'abcdefghijk', new_string: 'STRIPE_KEY=sk_live_' + 'zyxwvutsrqp' } }),
  ];
  const all = JSON.stringify(recs);
  for (const leak of ['SECRETSECRET', 'abcdefghijklmnopqrstuv', 'ghp_0123', 'sk-proj-abc', 'hunter2hunter2', 'sk_live_abc', 'sk_live_zyx']) {
    assert.ok(!all.includes(leak), `leaked ${leak}`);
  }
});

test('messages Claude Code injects as prompts are not shown as user requests', () => {
  const p = FIXTURE.find((x) => x.hook_event_name === 'UserPromptSubmit' && x.prompt.startsWith('<task-notification>'));
  const r = buildRecord(p);
  assert.equal(r.system, true);
  assert.equal(r.text, undefined);
  assert.equal(r.title.fr, 'Une tâche en arrière-plan a terminé et Claude reprend');
});
