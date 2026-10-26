'use strict';
// Token usage from Claude Code's own transcript file (the path arrives in every hook payload).
// Read lazily by the dashboard, never by hooks, and cached by file size.

const fs = require('fs');

const cache = new Map();

function usageFromTranscript(file) {
  if (!file) return null;
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.size === st.size) return hit.value;
  if (st.size > 64 * 1024 * 1024) return null; // absurdly large: skip rather than block
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const u = { model: null, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 };
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type !== 'assistant' || !d.message || !d.message.usage) continue;
    // One API response can be split across several transcript lines: count it once.
    const key = d.requestId || d.message.id || d.uuid;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const m = d.message.usage;
    u.turns++;
    u.input += m.input_tokens || 0;
    u.output += m.output_tokens || 0;
    u.cacheRead += m.cache_read_input_tokens || 0;
    u.cacheWrite += m.cache_creation_input_tokens || 0;
    u.context = (m.input_tokens || 0) + (m.cache_read_input_tokens || 0) + (m.cache_creation_input_tokens || 0);
    if (d.message.model) u.model = d.message.model;
  }
  cache.set(file, { size: st.size, value: u });
  return u;
}

module.exports = { usageFromTranscript };
