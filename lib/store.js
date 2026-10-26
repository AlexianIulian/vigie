'use strict';
// Append-only storage: one JSON line per event, one file per session, under ~/.vigie/sessions.
// Hooks only ever append a single line, which keeps them fast and safe when several
// Claude Code sessions run at once. Readers (dashboard, terminal view) tail the files.

const fs = require('fs');
const path = require('path');

function sessionsDir(home) {
  return path.join(home, 'sessions');
}

function safeId(id) {
  return String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function sessionFile(home, sessionId) {
  return path.join(sessionsDir(home), safeId(sessionId) + '.jsonl');
}

function append(home, record) {
  const dir = sessionsDir(home);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(sessionFile(home, record.session), JSON.stringify(record) + '\n');
}

function readSession(home, sessionId) {
  return parseLines(readSafe(sessionFile(home, sessionId)));
}

function readSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a half-written last line: skip it, the next read will get it */
    }
  }
  return out;
}

function listSessionFiles(home) {
  const dir = sessionsDir(home);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return names
    .map((n) => {
      const file = path.join(dir, n);
      try {
        const st = fs.statSync(file);
        return { id: n.slice(0, -6), file, size: st.size, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

/** Delete session files older than `days`. Run by the server, never by hooks. */
function prune(home, days) {
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  for (const s of listSessionFiles(home)) {
    if (s.mtime < cutoff) {
      try {
        fs.unlinkSync(s.file);
        removed++;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

/**
 * Follow every session file and call `onRecord(record)` for each new line.
 * Polling (not fs.watch) because it behaves the same on macOS, Windows and Linux.
 * Returns a stop() function.
 */
function follow(home, onRecord, { fromStart = false, interval = 300, sinceMs = 0 } = {}) {
  const offsets = new Map();
  const partial = new Map();
  let stopped = false;
  const first = () => {
    for (const s of listSessionFiles(home)) offsets.set(s.file, fromStart && s.mtime >= sinceMs ? 0 : s.size);
  };
  const tick = () => {
    if (stopped) return;
    for (const s of listSessionFiles(home)) {
      const prev = offsets.has(s.file) ? offsets.get(s.file) : 0;
      if (s.size < prev) offsets.set(s.file, 0);
      const start = offsets.get(s.file) ?? 0;
      if (s.size <= start) continue;
      let chunk = '';
      try {
        const fd = fs.openSync(s.file, 'r');
        const buf = Buffer.alloc(s.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        chunk = buf.toString('utf8');
      } catch {
        continue;
      }
      offsets.set(s.file, s.size);
      const text = (partial.get(s.file) || '') + chunk;
      const lines = text.split('\n');
      partial.set(s.file, lines.pop());
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onRecord(JSON.parse(line));
        } catch {
          /* ignore malformed line */
        }
      }
    }
  };
  first();
  if (fromStart) tick();
  const timer = setInterval(tick, interval);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = { append, readSession, listSessionFiles, sessionFile, sessionsDir, prune, follow, parseLines, safeId };
