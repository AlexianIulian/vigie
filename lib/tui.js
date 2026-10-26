'use strict';
// Terminal view: a live, narrated feed of what Claude Code is doing, for a split pane
// next to your Claude Code session. Plain streaming lines, so it works in any terminal
// and keeps scrollback.

const store = require('./store');
const { rank } = require('./risk');
const { basename, isInside } = require('./util');

function makePalette(color) {
  const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    dim: c('2'),
    bold: c('1'),
    cyan: c('36'),
    blue: c('34'),
    green: c('32'),
    yellow: c('33'),
    red: c('31'),
    redBold: c('1;31'),
    magenta: c('35'),
    inverse: c('7'),
  };
}

const ICONS = {
  emoji: { read: '📖', write: '📝', edit: '✏️ ', exec: '⚡', search: '🔎', web: '🌐', agent: '🧭', plan: '🗒️ ', ask: '❓', skill: '🧩', mcp: '🔌', other: '•', prompt: '💬', stop: '✅', session: '⚓', notify: '🔔', compact: '🗜️ ', fail: '✗', ok: '↳' },
  ascii: { read: '[lit]', write: '[ecr]', edit: '[mod]', exec: '[cmd]', search: '[chr]', web: '[web]', agent: '[agt]', plan: '[pln]', ask: '[ ? ]', skill: '[skl]', mcp: '[mcp]', other: '[ . ]', prompt: '[you]', stop: '[fin]', session: '[ses]', notify: '[ ! ]', compact: '[cmp]', fail: 'x', ok: '->' },
};

const RISK_LABEL = {
  fr: { low: 'faible', medium: 'à surveiller', high: 'risque élevé', critical: 'RISQUE CRITIQUE' },
  en: { low: 'low', medium: 'watch', high: 'high risk', critical: 'CRITICAL RISK' },
};

function time(ts) {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

function createRenderer({ lang = 'fr', color = true, ascii = false, write = (s) => process.stdout.write(s), width = process.stdout.columns || 100 } = {}) {
  const p = makePalette(color);
  const I = ascii ? ICONS.ascii : ICONS.emoji;
  const pad = ' '.repeat(10);
  const t = (o) => (o ? o[lang] || o.fr || '' : '');
  const projects = new Map();
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const indent = pad + ' '.repeat(16);
  /** Word-wrap long explanations instead of cutting them (max 3 lines). */
  const wrap = (s, n, max = 3) => {
    const words = String(s).split(/\s+/);
    const out = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > n && cur) {
        out.push(cur);
        cur = w;
      } else cur = (cur + ' ' + w).trim();
    }
    if (cur) out.push(cur);
    if (out.length > max) out.splice(max - 1, out.length, clip(out.slice(max - 1).join(' '), n));
    return out;
  };

  function tag(rec) {
    const name = rec.cwd ? basename(rec.cwd) : String(rec.session).slice(0, 8);
    projects.set(rec.session, name);
    return p.dim(clip(name, 14).padEnd(14));
  }

  function riskBadge(r) {
    if (!r || rank(r.level) < rank('medium')) return '';
    const label = RISK_LABEL[lang][r.level];
    if (r.level === 'critical') return p.redBold(` ${ascii ? '!!' : '⛔'} ${label} `);
    if (r.level === 'high') return p.red(` ${ascii ? '!' : '⚠'} ${label} `);
    return p.yellow(` ${ascii ? '~' : '△'} ${label} `);
  }

  function line(rec) {
    const head = `${p.dim(time(rec.ts))} ${tag(rec)} `;
    const sub = rec.agent ? p.magenta(lang === 'fr' ? '↳ sous-agent ' : '↳ sub-agent ') : '';
    switch (rec.event) {
      case 'SessionStart':
        return `${head}${I.session} ${p.bold(t(rec.title))} ${p.dim(rec.cwd || '')}\n`;
      case 'UserPromptSubmit':
        return `\n${head}${I.prompt} ${p.cyan(clip(t(rec.title), width - 30))}\n`;
      case 'PreToolUse': {
        const icon = I[rec.kind] || I.other;
        const badge = riskBadge(rec.risk);
        let out = `${head}${sub}${icon} ${badge ? badge + ' ' : ''}${clip(t(rec.title), width - 34)}\n`;
        if (rec.tool === 'Bash' && rec.input && rec.input.command) out += `${pad}${' '.repeat(16)}${p.dim('$ ' + clip(String(rec.input.command).split('\n')[0], width - 30))}\n`;
        if (rec.risk && rank(rec.risk.level) >= rank('medium')) {
          const paint = rec.risk.level === 'medium' ? p.yellow : p.red;
          for (const r of rec.risk.reasons.slice(0, 2)) for (const l of wrap(r[lang], Math.max(30, width - 30))) out += `${indent}${paint(l)}\n`;
        }
        if (rec.guard) out += `${pad}${' '.repeat(16)}${p.inverse(lang === 'fr' ? (rec.guard.decision === 'deny' ? ' Vigie a bloqué cette action ' : ' Vigie te demande de confirmer ') : rec.guard.decision === 'deny' ? ' Vigie blocked this action ' : ' Vigie asks you to confirm ')}\n`;
        return out;
      }
      case 'PostToolUse':
        return `${pad}${' '.repeat(16)}${p.green(I.ok)} ${p.dim(clip(t(rec.result), width - 32))}\n`;
      case 'PostToolUseFailure':
        return `${pad}${' '.repeat(16)}${p.red(I.fail + ' ' + clip(t(rec.result), width - 32))}\n`;
      case 'SubagentStart':
      case 'SubagentStop':
        return `${head}${I.agent} ${p.magenta(t(rec.title))}\n`;
      case 'Stop':
        return `${head}${I.stop} ${p.green(t(rec.title))}\n`;
      case 'Notification':
        return `${head}${I.notify} ${p.yellow(t(rec.title))}\n`;
      case 'PreCompact':
        return `${head}${I.compact} ${p.dim(t(rec.title))}\n`;
      case 'SessionEnd':
        return `${head}${I.session} ${p.dim(t(rec.title))}\n`;
      default:
        return '';
    }
  }

  function banner(url) {
    const title = lang === 'fr' ? 'ce que fait Claude, en clair' : 'what Claude is doing, in plain words';
    const left = `${p.inverse(' VIGIE ')} ${p.bold(title)}`;
    const right = url ? p.dim(url) : '';
    write(`\n${left}   ${right}\n${p.dim('─'.repeat(Math.min(width, 100)))}\n`);
  }

  return { render: (rec) => write(line(rec)), line, banner };
}

/** Run the live terminal view until Ctrl+C. */
function run(cfg, opts = {}) {
  const color = opts.color !== false && process.stdout.isTTY && !process.env.NO_COLOR;
  const ascii = opts.ascii || (process.platform === 'win32' && !process.env.WT_SESSION && !process.env.TERM_PROGRAM);
  const r = createRenderer({ lang: opts.lang || cfg.lang, color, ascii });
  const here = opts.here ? process.cwd() : null;
  const keep = (rec) => !here || (rec.cwd && isInside(rec.cwd, here));
  r.banner(opts.url);
  // Show the tail of the most recent session so the pane is not empty.
  const history = opts.history ?? 12;
  if (history > 0) {
    const files = store.listSessionFiles(cfg.home);
    const recent = files.find((f) => {
      const recs = store.readSession(cfg.home, f.id);
      return recs.length && keep(recs[recs.length - 1]);
    });
    if (recent) {
      const recs = store.readSession(cfg.home, recent.id).filter(keep);
      for (const rec of recs.slice(-history)) r.render(rec);
    }
  }
  const waiting = cfg.lang === 'fr' ? 'En veille… lance Claude Code dans un autre terminal.' : 'Watching… start Claude Code in another terminal.';
  process.stdout.write(`\x1b[2m${waiting}\x1b[0m\n`);
  return store.follow(cfg.home, (rec) => {
    if (keep(rec)) r.render(rec);
  });
}

module.exports = { run, createRenderer };
