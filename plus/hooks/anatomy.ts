// Lecture des commandes : découpe une ligne de shell en morceaux colorés,
// retrouve les notions qu'elle contient et explique ses options.
import type { Token, TokenKind } from '../types'
import { FLAGS, LESSONS } from './lessons'

export const KIND_COLOR: Record<TokenKind, string> = {
  bin: 'claude',
  sub: 'suggestion',
  flag: 'warning',
  arg: 'text',
  path: 'ide',
  op: 'success',
  str: 'subtle',
  var: 'merged',
}

export const KIND_LABEL: Record<TokenKind, string> = {
  bin: 'programme',
  sub: 'sous-commande',
  flag: 'option',
  arg: 'argument',
  path: 'chemin',
  op: 'opérateur',
  str: 'texte',
  var: 'variable',
}

const OPERATORS = ['2>&1', '&&', '||', '>>', '$(', '|', ';', '>', '<', ')', '&']

// Masque ce qui ressemble à une clé avant d'afficher ou d'envoyer une commande.
export function redact(text: string) {
  return text
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA)[-_A-Za-z0-9]{12,}/g, '••••')
    .replace(/((?:api[_-]?key|token|secret|password|passwd|authorization)\s*[=:]\s*["']?)[^\s"']+/gi, '$1••••')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1••••')
}

// Retire le contenu des chaînes entre guillemets pour ne pas prendre un `|`
// écrit dans un message pour un vrai tuyau.
export function unquote(cmd: string) {
  return cmd.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

export function anatomize(raw: string, max = 180): Token[] {
  const line = raw.split('\n')[0] ?? ''
  const src = line.length > max ? line.slice(0, max) + ' …' : line
  const out: Token[] = []
  let i = 0
  let atStart = true
  let bin = ''
  let hasSub = false

  while (i < src.length) {
    const c = src[i]!
    if (c === ' ' || c === '\t') {
      let j = i
      while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++
      out.push({ text: ' ', kind: 'arg' })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' && c === '"' ? 2 : 1
      out.push({ text: src.slice(i, j + 1), kind: 'str' })
      i = j + 1
      atStart = false
      continue
    }
    const op = OPERATORS.find(o => src.startsWith(o, i))
    if (op) {
      out.push({ text: op, kind: 'op' })
      i += op.length
      if (op !== ')' && op !== '>' && op !== '>>' && op !== '<' && op !== '2>&1') {
        atStart = true
        hasSub = false
      }
      continue
    }
    let j = i
    while (j < src.length && !' \t"\'|;&<>()'.includes(src[j]!)) j++
    if (j === i) j = i + 1
    const word = src.slice(i, j)
    i = j

    let kind: TokenKind
    if (atStart && /^\w+=/.test(word)) kind = 'var'
    else if (atStart) {
      kind = 'bin'
      bin = word.replace(/^.*\//, '')
      atStart = word === 'sudo'
      if (word === 'sudo') bin = ''
    } else if (word.startsWith('-') || (word.startsWith('+') && word.length <= 3)) kind = 'flag'
    else if (word.startsWith('$')) kind = 'var'
    else if (!hasSub && LESSONS[`${bin} ${word}`]) {
      kind = 'sub'
      hasSub = true
    } else if (/[/~]|^\.{1,2}$|\.[a-z0-9]{1,5}$/i.test(word)) kind = 'path'
    else kind = 'arg'
    out.push({ text: word, kind })
  }
  return out
}

// Les options d'une commande, expliquées : `-la` devient `-l` et `-a`.
export function explainFlags(raw: string, limit = 5): { flag: string; text: string }[] {
  const found: { flag: string; text: string }[] = []
  let bin = ''
  for (const t of anatomize(unquote(raw), 400)) {
    if (t.kind === 'bin') bin = t.text.replace(/^.*\//, '')
    if (bin === 'python') bin = 'python3'
    if (t.kind === 'op' && ['|', '&&', '||', ';'].includes(t.text)) bin = ''
    if (t.kind !== 'flag' && !(t.kind === 'arg' && bin === 'ps')) continue
    const table = { ...FLAGS['*'], ...(FLAGS[bin] ?? {}) }
    const name = t.text.split('=')[0]!
    const push = (flag: string) => {
      const text = table[flag]
      if (text && !found.some(f => f.flag === flag && f.text === text)) found.push({ flag, text })
    }
    if (table[name]) push(name)
    else if (/^-[a-zA-Z]{2,}$/.test(name)) for (const ch of name.slice(1)) push(`-${ch}`)
    if (found.length >= limit) break
  }
  return found.slice(0, limit)
}

export function bashConcepts(raw: string): string[] {
  const keys: string[] = []
  const add = (k: string) => {
    if (LESSONS[k] && !keys.includes(k)) keys.push(k)
  }
  const heredoc = /<<-?\s*'?\w+'?/.test(raw)
  const body = unquote(heredoc ? (raw.split(/<<-?\s*'?\w+'?/)[0] ?? '') : raw)

  for (const seg of body.split(/\|\||&&|\||;|\n|\$\(/)) {
    const words = seg.trim().split(/\s+/).filter(w => !/^\w+=/.test(w))
    if (words[0] === 'sudo') {
      add('sudo')
      words.shift()
    }
    if (!words[0]) continue
    const bin = words[0].replace(/^\(+/, '').replace(/^.*\//, '')
    const sub = words.slice(1).find(w => !w.startsWith('-'))
    if (bin === 'python') add('python3')
    if (sub && LESSONS[`${bin} ${sub}`]) add(`${bin} ${sub}`)
    add(bin)
  }
  if (/\|/.test(body.replace(/\|\|/g, ''))) add('pipe')
  if (body.includes('&&')) add('and')
  if (body.includes(';')) add('seq')
  if (body.includes('2>&1')) add('stderr')
  if (/(^|[^0-9&>])>{1,2}\s*[^&\s]/.test(body)) add('redirect')
  if (body.includes('$(')) add('subst')
  if (heredoc) add('heredoc')
  if (/(^|\s)~\//.test(body)) add('home')
  if (/(^|\s|\/)[\w.-]*\*[\w.]*/.test(body)) add('glob')
  return keys
}

// Programmes de la commande qu'aucune fiche ne couvre : le coach les explique.
export function unknownBins(raw: string): string[] {
  return anatomize(unquote(raw), 400)
    .filter(t => t.kind === 'bin')
    .map(t => t.text.replace(/^.*\//, ''))
    .filter(b => b !== 'sudo' && !LESSONS[b] && !(b === 'python' && LESSONS.python3))
}

export const RISKY_BASH =
  /\brm\s+-\w*[rf]|\bsudo\b|push\s+(\S+\s+)*(-f\b|--force)|reset\s+--hard|\bkill\s+-9|chmod\s+(-R\s+)?777|>\s*\/dev\/sd|\bmkfs\b|\bdd\s+if=|git\s+clean\s+-\w*f|DROP\s+TABLE/i

// Un diff unifié court entre deux extraits, pour le composant Code.
export function miniDiff(path: string, before: string, after: string, keep = 6): string {
  const a = before === '' ? [] : before.split('\n').slice(0, keep)
  const b = after.split('\n').slice(0, keep)
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    a.length ? `@@ -1,${a.length} +1,${b.length} @@` : `@@ -0,0 +1,${b.length} @@`,
    ...a.map(l => `-${l}`),
    ...b.map(l => `+${l}`),
  ].join('\n')
}
