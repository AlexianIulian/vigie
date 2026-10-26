'use strict';
// Configuration, resolved in this order (first wins):
//   1. environment variables VIGIE_*         (power users, CI)
//   2. plugin options CLAUDE_PLUGIN_OPTION_* (set with `claude plugin configure vigie` or /config)
//   3. ~/.vigie/config.json                  (written by `vigie config set`)
//   4. defaults below

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  lang: 'auto', // fr | en | auto (from the system locale)
  guard: 'ask', // off | ask | deny   what to do with risky actions before they run
  guardLevel: 'high', // high | critical   from which risk level the guard steps in
  port: 7456,
  autostart: true, // start the dashboard server in the background when a session starts
  retentionDays: 30,
};

function home() {
  return process.env.VIGIE_HOME || path.join(os.homedir(), '.vigie');
}

function readFileConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(home(), 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function pick(name) {
  const env = process.env[`VIGIE_${name.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`];
  if (env != null && env !== '') return env;
  const opt = process.env[`CLAUDE_PLUGIN_OPTION_${name.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`];
  if (opt != null && opt !== '') return opt;
  return undefined;
}

function bool(v, d) {
  if (v === undefined || v === null || v === '') return d;
  if (typeof v === 'boolean') return v;
  return !/^(0|false|no|off|non)$/i.test(String(v));
}

function detectLang() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  let loc = env;
  if (!loc) {
    try {
      loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
    } catch {
      loc = '';
    }
  }
  return /^fr/i.test(loc) ? 'fr' : 'en';
}

function load() {
  const file = readFileConfig();
  const raw = {};
  for (const k of Object.keys(DEFAULTS)) {
    const v = pick(k);
    raw[k] = v !== undefined ? v : file[k] !== undefined ? file[k] : DEFAULTS[k];
  }
  const cfg = {
    home: home(),
    lang: String(raw.lang).toLowerCase(),
    guard: String(raw.guard).toLowerCase(),
    guardLevel: String(raw.guardLevel).toLowerCase(),
    port: parseInt(raw.port, 10) || DEFAULTS.port,
    autostart: bool(raw.autostart, DEFAULTS.autostart),
    retentionDays: parseInt(raw.retentionDays, 10) || DEFAULTS.retentionDays,
  };
  if (cfg.lang !== 'fr' && cfg.lang !== 'en') cfg.lang = detectLang();
  if (!['off', 'ask', 'deny'].includes(cfg.guard)) cfg.guard = DEFAULTS.guard;
  if (!['medium', 'high', 'critical'].includes(cfg.guardLevel)) cfg.guardLevel = DEFAULTS.guardLevel;
  return cfg;
}

function save(patch) {
  const dir = home();
  fs.mkdirSync(dir, { recursive: true });
  const next = { ...readFileConfig(), ...patch };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { load, save, home, DEFAULTS };
