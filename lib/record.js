'use strict';
// Turns one Claude Code hook payload into a stored record, and decides whether the
// guard should step in before a risky tool call runs.

const { sanitize } = require('./redact');
const { truncate, shortId } = require('./util');
const narrate = require('./narrate');
const risk = require('./risk');

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);

function summariseResponse(tool, resp) {
  if (resp == null) return null;
  if (typeof resp === 'string') return sanitize(resp, 800);
  const r = resp;
  switch (tool) {
    case 'Read':
      return { lines: r.file?.numLines ?? null, totalLines: r.file?.totalLines ?? null, excerpt: sanitize(r.file?.content ?? '', 400) };
    case 'Write':
      return { type: r.type, excerpt: sanitize(r.content ?? '', 400) };
    case 'Edit':
    case 'MultiEdit':
      return { patch: sanitize((r.structuredPatch || []).slice(0, 8).map((h) => ({ oldStart: h.oldStart, newStart: h.newStart, lines: (h.lines || []).slice(0, 40) })), 300) };
    case 'Bash':
    case 'PowerShell':
      return { stdout: sanitize(r.stdout ?? '', 1500), stderr: sanitize(r.stderr ?? '', 600), interrupted: !!r.interrupted, background: r.backgroundTaskId || null };
    case 'Grep':
    case 'Glob':
      return { numFiles: r.numFiles ?? null, numLines: r.numLines ?? null, filenames: sanitize((r.filenames || []).slice(0, 20), 200), excerpt: sanitize(r.content ?? '', 600) };
    case 'Agent':
    case 'Task':
      return { status: r.status ?? null, agentId: r.agentId ?? null, async: !!r.isAsync };
    default:
      return sanitize(r, 600);
  }
}

function summariseInput(tool, input) {
  if (!input || typeof input !== 'object') return {};
  if (tool === 'Write') return sanitize({ ...input, content: truncate(String(input.content ?? ''), 600) }, 600);
  if (tool === 'Agent' || tool === 'Task') return sanitize(input, 800);
  return sanitize(input, 1500);
}

/** Build the record stored for one hook payload. */
function buildRecord(raw, now = Date.now()) {
  // Redact once, up front: everything stored or narrated below comes from the redacted copy.
  // Only the risk engine sees the raw payload (it needs the real command, never stores it).
  const p = sanitize(raw, 100000);
  const ev = p.hook_event_name || 'Unknown';
  const tool = p.tool_name || null;
  const rec = {
    v: 1,
    id: shortId(),
    ts: now,
    session: p.session_id || 'unknown',
    event: ev,
    prompt: p.prompt_id || null,
    cwd: p.cwd || null,
    mode: p.permission_mode || null,
  };
  if (p.agent_id || p.agent_type) rec.agent = { id: p.agent_id || null, type: p.agent_type || null };
  if (p.transcript_path) rec.transcript = p.transcript_path;

  if (TOOL_EVENTS.has(ev) && tool) {
    rec.tool = tool;
    rec.toolUseId = p.tool_use_id || null;
    rec.kind = narrate.kindOf(tool);
    rec.input = summariseInput(tool, p.tool_input);
    rec.files = narrate.filesOf(tool, p.tool_input);
    const call = narrate.describeCall(tool, p.tool_input || {}, p.cwd);
    rec.title = call.title;
    if (call.detail) rec.detail = call.detail;
    if (call.steps) rec.steps = call.steps;
    if (call.intent) rec.intent = call.intent;
    if (ev === 'PreToolUse' || ev === 'PermissionRequest') {
      rec.risk = risk.assess(raw);
    } else if (ev === 'PostToolUse') {
      rec.output = summariseResponse(tool, p.tool_response);
      rec.result = narrate.describeResult(tool, p.tool_input || {}, p.tool_response, p.duration_ms);
      if (p.duration_ms != null) rec.durationMs = p.duration_ms;
    } else if (ev === 'PostToolUseFailure') {
      rec.error = sanitize(String(p.error ?? ''), 800);
      rec.interrupted = !!p.is_interrupt;
      rec.result = narrate.describeFailure(p.error, p.is_interrupt);
      if (p.duration_ms != null) rec.durationMs = p.duration_ms;
    } else if (ev === 'PermissionDenied') {
      rec.result = narrate.describeEvent(p);
    }
  } else {
    rec.title = narrate.describeEvent(p);
    if (ev === 'UserPromptSubmit') {
      if (narrate.isSystemPrompt(p.prompt)) rec.system = true;
      else rec.text = sanitize(String(p.prompt ?? ''), 2000);
    }
    if (ev === 'Stop' || ev === 'SubagentStop') rec.text = sanitize(String(p.last_assistant_message ?? ''), 1500);
    if (ev === 'Notification') rec.text = sanitize(String(p.message ?? ''), 400);
    if (ev === 'SessionStart') rec.source = p.source || null;
    if (ev === 'SessionEnd') rec.reason = p.reason || null;
    if (ev === 'PostToolBatch' && Array.isArray(p.tool_calls)) rec.count = p.tool_calls.length;
  }
  return rec;
}

/**
 * Should the guard intervene? Returns the JSON Claude Code expects from a PreToolUse hook,
 * or null to let the normal permission flow continue untouched.
 */
function guardOutput(rec, cfg) {
  if (rec.event !== 'PreToolUse' || !rec.risk || cfg.guard === 'off') return null;
  if (risk.rank(rec.risk.level) < risk.rank(cfg.guardLevel)) return null;
  const lang = cfg.lang === 'en' ? 'en' : 'fr';
  const reasons = rec.risk.reasons.filter((r) => r.code !== 'bypass').slice(0, 2).map((r) => r[lang]).join(' ');
  const label = lang === 'fr'
    ? { high: 'risque élevé', critical: 'risque critique', medium: 'risque moyen' }[rec.risk.level]
    : { high: 'high risk', critical: 'critical risk', medium: 'medium risk' }[rec.risk.level];
  const what = rec.title ? rec.title[lang] : rec.tool;
  let reason;
  if (cfg.guard === 'deny') {
    reason = lang === 'fr'
      ? `Vigie a bloqué cette action (${label}) : ${what}. ${reasons} Demande d'abord une confirmation explicite à l'utilisateur, ou propose une alternative plus sûre.`
      : `Vigie blocked this action (${label}): ${what}. ${reasons} Ask the user for explicit confirmation first, or suggest a safer alternative.`;
  } else {
    reason = lang === 'fr' ? `Vigie — ${label} : ${what}. ${reasons}` : `Vigie — ${label}: ${what}. ${reasons}`;
  }
  rec.guard = { decision: cfg.guard, level: rec.risk.level };
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: cfg.guard,
      permissionDecisionReason: reason,
    },
  };
}

module.exports = { buildRecord, guardOutput, summariseResponse };
