'use strict';
// Secret redaction. Everything Vigie stores on disk passes through here first,
// so a `cat .env` run by Claude does not leave your keys in ~/.vigie.

const { truncate } = require('./util');

const MASK = '[secret masqué]';

// Patterns for well-known credential formats. Order matters: specific before generic.
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/g, // OpenAI-style
  /\b[sr]k_(live|test)_[A-Za-z0-9]{8,}/g, // Stripe
  /\bwhsec_[A-Za-z0-9]{16,}/g, // Stripe webhooks
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g, // GitLab
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\bya29\.[0-9A-Za-z_-]{20,}/g, // Google OAuth
  /\bnpm_[A-Za-z0-9]{30,}/g, // npm
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, // SendGrid
];

// KEY=value or KEY: value where the key name says it is secret.
const SECRET_ASSIGN =
  /(\b[A-Za-z0-9_.-]*(SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|AUTH)[A-Za-z0-9_.-]*\s*[=:]\s*)(["']?)([^\s"'`,;[][^\s"'`,;]{3,})\3/gi;

// scheme://user:password@host
const URL_CREDS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{2,})(@)/gi;

// Authorization: Bearer xxx
const BEARER = /(\b(?:Bearer|Basic|Token)\s+)([A-Za-z0-9._~+/=-]{12,})/g;

function redactString(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const re of PATTERNS) out = out.replace(re, MASK);
  out = out.replace(BEARER, (_m, a) => `${a}${MASK}`);
  out = out.replace(SECRET_ASSIGN, (m, k, _n, q, val) => (/^(Bearer|Basic|Token)$/i.test(val) || val === MASK ? m : `${k}${q}${MASK}${q}`));
  out = out.replace(URL_CREDS, (_m, a, _p, at) => `${a}${MASK}${at}`);
  return out;
}

/**
 * Deep-copy a value, redacting secrets in every string and shortening long strings.
 * `maxLen` keeps the store small: file contents and huge outputs are not needed to narrate.
 */
function sanitize(value, maxLen = 2000, depth = 0) {
  if (depth > 6) return '[…]';
  if (typeof value === 'string') return truncate(redactString(value), maxLen);
  if (Array.isArray(value)) {
    const arr = value.slice(0, 50).map((v) => sanitize(v, maxLen, depth + 1));
    if (value.length > 50) arr.push(`[+${value.length - 50} éléments]`);
    return arr;
  }
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = sanitize(v, maxLen, depth + 1);
    return o;
  }
  return value;
}

function containsSecret(s) {
  return typeof s === 'string' && redactString(s) !== s;
}

module.exports = { redactString, sanitize, containsSecret, MASK };
