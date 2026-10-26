'use strict';
// Small helpers shared by every module. No dependencies.

const os = require('os');
const crypto = require('crypto');

/** Normalise a path to forward slashes so Windows and POSIX paths compare the same way. */
function fwd(p) {
  return typeof p === 'string' ? p.replace(/\\/g, '/') : '';
}

function isWinPath(p) {
  return /^[a-zA-Z]:\//.test(fwd(p));
}

function samePrefix(child, parent) {
  const c = fwd(child);
  const p = fwd(parent).replace(/\/+$/, '');
  if (!p) return false;
  if (isWinPath(c) || isWinPath(p)) {
    const cl = c.toLowerCase();
    const pl = p.toLowerCase();
    return cl === pl || cl.startsWith(pl + '/');
  }
  return c === p || c.startsWith(p + '/');
}

/** Is `file` inside `dir`? Handles Windows drive letters and case-insensitivity. */
function isInside(file, dir) {
  if (!file || !dir) return false;
  return samePrefix(file, dir);
}

/** Display a path the way a person reads it: relative to the project, else with ~ for home. */
function displayPath(file, cwd) {
  if (!file) return '';
  const f = fwd(file);
  const c = fwd(cwd || '').replace(/\/+$/, '');
  if (c && isInside(f, c)) {
    const rel = f.slice(c.length).replace(/^\/+/, '');
    return rel || '.';
  }
  const home = fwd(os.homedir());
  if (home && isInside(f, home)) return '~' + f.slice(home.length);
  return f;
}

function truncate(s, max) {
  if (typeof s !== 'string') return s;
  if (s.length <= max) return s;
  return s.slice(0, max) + `… [+${s.length - max}]`;
}

/** First non-empty line, shortened. Used for one-line previews of outputs. */
function firstLine(s, max = 120) {
  if (typeof s !== 'string') return '';
  const line = s.split(/\r?\n/).find((l) => l.trim()) || '';
  return truncate(line.trim(), max);
}

function shortId() {
  return crypto.randomBytes(6).toString('hex');
}

function countLines(s) {
  if (typeof s !== 'string' || !s) return 0;
  return s.split(/\r?\n/).length - (s.endsWith('\n') ? 1 : 0);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return typeof url === 'string' ? truncate(url, 60) : '';
  }
}

function basename(p) {
  const f = fwd(p).replace(/\/+$/, '');
  return f.slice(f.lastIndexOf('/') + 1) || f;
}

module.exports = { fwd, isInside, displayPath, truncate, firstLine, shortId, countLines, hostOf, basename };
