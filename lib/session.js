'use strict';
// Builds a session summary from its records: what was read, changed, run, and how risky it got.

const { basename, displayPath } = require('./util');
const { rank } = require('./risk');

const ACTIVE_MS = 15 * 60 * 1000;

function summarise(id, records, now = Date.now()) {
  const s = {
    id,
    cwd: null,
    project: null,
    startedAt: null,
    lastAt: null,
    title: null,
    status: 'idle',
    model: null,
    transcript: null,
    counts: { prompts: 0, reads: 0, edits: 0, commands: 0, searches: 0, web: 0, agents: 0, failures: 0, risky: 0, guarded: 0, tools: 0 },
    maxRisk: 'none',
    files: {},
    current: null,
  };
  const pending = new Map();
  for (const r of records) {
    if (!s.startedAt) s.startedAt = r.ts;
    s.lastAt = r.ts;
    if (r.cwd && !s.cwd) s.cwd = r.cwd;
    if (r.transcript && !s.transcript) s.transcript = r.transcript;
    switch (r.event) {
      case 'UserPromptSubmit':
        if (r.system) break;
        s.counts.prompts++;
        if (!s.title && r.text) s.title = r.text.replace(/\s+/g, ' ').slice(0, 140);
        break;
      case 'PreToolUse':
        s.counts.tools++;
        if (r.toolUseId) pending.set(r.toolUseId, r);
        if (r.risk && rank(r.risk.level) >= rank('medium')) s.counts.risky++;
        if (r.risk && rank(r.risk.level) > rank(s.maxRisk)) s.maxRisk = r.risk.level;
        if (r.guard) s.counts.guarded++;
        if (r.kind === 'read') s.counts.reads++;
        else if (r.kind === 'write' || r.kind === 'edit') s.counts.edits++;
        else if (r.kind === 'exec') s.counts.commands++;
        else if (r.kind === 'search') s.counts.searches++;
        else if (r.kind === 'web') s.counts.web++;
        else if (r.kind === 'agent') s.counts.agents++;
        for (const f of r.files || []) {
          const k = f;
          const entry = s.files[k] || { path: f, display: displayPath(f, s.cwd), read: 0, changed: 0, created: false };
          if (r.kind === 'read') entry.read++;
          if (r.kind === 'write' || r.kind === 'edit') entry.changed++;
          s.files[k] = entry;
        }
        break;
      case 'PostToolUse':
        if (r.toolUseId) pending.delete(r.toolUseId);
        if (r.tool === 'Write' && r.output && r.output.type === 'create') {
          for (const f of r.files || []) if (s.files[f]) s.files[f].created = true;
        }
        break;
      case 'PostToolUseFailure':
        if (r.toolUseId) pending.delete(r.toolUseId);
        s.counts.failures++;
        break;
      default:
        break;
    }
  }
  s.project = s.cwd ? basename(s.cwd) : id.slice(0, 8);
  const last = records[records.length - 1];
  const open = [...pending.values()];
  s.current = open.length ? open[open.length - 1] : last || null;
  if (!last) s.status = 'idle';
  else if (last.event === 'SessionEnd') s.status = 'ended';
  else if (now - s.lastAt > ACTIVE_MS) s.status = 'idle';
  else if (last.event === 'Stop' || last.event === 'Notification' || last.event === 'StopFailure') s.status = last.event === 'Notification' ? 'needs-you' : 'waiting';
  else s.status = 'working';
  s.files = Object.values(s.files).sort((a, b) => b.changed - a.changed || b.read - a.read);
  return s;
}

module.exports = { summarise };
