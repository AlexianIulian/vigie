// Les règles du jeu : niveaux, badges, quêtes du jour, série de jours et
// quiz à répétition espacée (boîtes de Leitner). Des fonctions pures.
import type { Profile, QuestState, Quiz, QuizKind } from '../types'
import { BADGES, FLAGS, LESSONS, LEVELS } from './lessons'

export const XP = { action: 5, fresh: 15, quiz: 20, decode: 10, prof: 10 }

export const EMPTY: Profile = {
  xp: 0,
  actions: 0,
  seen: [],
  badges: [],
  quizRight: 0,
  quizTotal: 0,
  boxes: {},
  days: {},
  streak: { last: '', count: 0, best: 0 },
  quests: { date: '', items: [] },
  bestCombo: 0,
  risky: 0,
  decoded: 0,
  settings: { sound: true, band: true, coach: false, prof: false },
}

// Un profil enregistré par la v1 (ou abîmé) est complété champ par champ.
export function normalize(raw: unknown): Profile {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Profile>
  return {
    ...EMPTY,
    ...p,
    seen: Array.isArray(p.seen) ? p.seen : [],
    badges: Array.isArray(p.badges) ? p.badges : [],
    boxes: p.boxes && typeof p.boxes === 'object' ? p.boxes : {},
    days: p.days && typeof p.days === 'object' ? p.days : {},
    streak: { ...EMPTY.streak, ...(p.streak ?? {}) },
    quests: p.quests?.items ? p.quests : EMPTY.quests,
    settings: { ...EMPTY.settings, ...(p.settings ?? {}) },
  }
}

// ── Temps ────────────────────────────────────────────────────────────────

export function dayKey(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dayIndex(ms: number) {
  const d = new Date(ms)
  return Math.floor((ms - d.getTimezoneOffset() * 60000) / 86400000)
}

export function lastDays(ms: number, n: number) {
  return Array.from({ length: n }, (_, i) => dayKey(ms - (n - 1 - i) * 86400000))
}

// ── Niveaux ──────────────────────────────────────────────────────────────

export function levelOf(xp: number) {
  let index = 0
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]!.at) index = i
  return { index, ...LEVELS[index]!, next: LEVELS[index + 1] }
}

export function comboBonus(combo: number) {
  return Math.min(3, 1 + Math.floor(combo / 5) * 0.5)
}

// ── Quêtes du jour ───────────────────────────────────────────────────────

export type QuestKind = 'fresh' | 'git' | 'pipe' | 'quizRight' | 'combo' | 'decode' | 'read' | 'edit' | 'codex' | 'action' | 'mcp'

export const QUESTS: Record<string, { icon: string; text: string; kind: QuestKind; goal: number; xp: number }> = {
  fresh3: { icon: '✨', text: 'Découvre 3 nouvelles notions', kind: 'fresh', goal: 3, xp: 40 },
  git2: { icon: '🌳', text: 'Observe 2 commandes git', kind: 'git', goal: 2, xp: 30 },
  pipe1: { icon: '🚰', text: 'Repère un tuyau |', kind: 'pipe', goal: 1, xp: 25 },
  quiz3: { icon: '🧠', text: 'Réponds juste à 3 quiz', kind: 'quizRight', goal: 3, xp: 45 },
  combo10: { icon: '⚡', text: 'Atteins un combo x10', kind: 'combo', goal: 10, xp: 35 },
  decode1: { icon: '🎓', text: 'Fais décoder une commande par le coach', kind: 'decode', goal: 1, xp: 25 },
  read5: { icon: '📖', text: 'Regarde Claude lire 5 fichiers', kind: 'read', goal: 5, xp: 20 },
  edit3: { icon: '🩹', text: 'Suis 3 modifications de fichiers', kind: 'edit', goal: 3, xp: 30 },
  codex2: { icon: '📚', text: 'Ouvre 2 fiches du Codex', kind: 'codex', goal: 2, xp: 15 },
  action30: { icon: '⚙️', text: 'Suis 30 actions de Claude', kind: 'action', goal: 30, xp: 30 },
  mcp1: { icon: '🔌', text: 'Vois un connecteur MCP en action', kind: 'mcp', goal: 1, xp: 25 },
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// Trois quêtes par jour, les mêmes toute la journée.
export function questsFor(date: string): QuestState[] {
  const ids = Object.keys(QUESTS).sort((a, b) => hash(date + a) - hash(date + b))
  return ids.slice(0, 3).map(id => ({ id, progress: 0, done: false }))
}

export type Gains = { toasts: string[]; sounds: string[] }

export function rollDay(p: Profile, today: string, gains: Gains): Profile {
  let next = p
  if (p.quests.date !== today) next = { ...next, quests: { date: today, items: questsFor(today) } }
  if (p.streak.last !== today) {
    const yesterday = dayKey(new Date(today + 'T12:00:00').getTime() - 86400000)
    const count = p.streak.last === yesterday ? p.streak.count + 1 : 1
    next = { ...next, streak: { last: today, count, best: Math.max(p.streak.best, count) } }
    if (count > 1) gains.toasts.push(`🔥 Série de ${count} jours ! Reviens demain pour la garder.`)
  }
  return next
}

// Avance les quêtes du jour ; `max` pour celles qui comptent un record (combo).
export function bump(p: Profile, kind: QuestKind, n: number, gains: Gains, max = false): Profile {
  let reward = 0
  const items = p.quests.items.map(q => {
    const def = QUESTS[q.id]
    if (!def || q.done || def.kind !== kind) return q
    const progress = max ? Math.max(q.progress, n) : q.progress + n
    if (progress >= def.goal) {
      reward += def.xp
      gains.toasts.push(`🎯 Quête accomplie : ${def.text} (+${def.xp} XP)`)
      gains.sounds.push('badge')
      return { ...q, progress: def.goal, done: true }
    }
    return { ...q, progress }
  })
  return { ...p, xp: p.xp + reward, quests: { ...p.quests, items } }
}

// ── Badges ───────────────────────────────────────────────────────────────

export function award(p: Profile, combo: number, gains: Gains): Profile {
  const has = new Set(p.badges)
  const rules: [string, boolean][] = [
    ['premier-pas', p.actions >= 1],
    ['plombier', p.seen.includes('pipe')],
    ['git-apprenti', p.seen.filter(k => k.startsWith('git ')).length >= 3],
    ['explorateur', p.seen.length >= 10],
    ['encyclopedie', p.seen.length >= 30],
    ['collection', p.seen.length >= 50],
    ['prudent', p.risky >= 1],
    ['quiz-5', p.quizRight >= 5],
    ['sage', p.quizRight >= 20],
    ['centurion', p.actions >= 100],
    ['connecte', p.seen.includes('mcp')],
    ['eclair', combo >= 10 || p.bestCombo >= 10],
    ['tornade', combo >= 25 || p.bestCombo >= 25],
    ['flamme', p.streak.count >= 3],
    ['comete', p.streak.count >= 7],
    ['chasseur', p.quests.items.some(q => q.done)],
    ['decodeur', p.decoded >= 1],
    ['maitre', Object.values(p.boxes).some(b => b.box >= 5)],
  ]
  for (const [id, ok] of rules) {
    if (ok && !has.has(id) && BADGES[id]) {
      has.add(id)
      const b = BADGES[id]!
      gains.toasts.push(`🏅 Badge débloqué : ${b.icon} ${b.name} (${b.why})`)
      gains.sounds.push('badge')
    }
  }
  return has.size === p.badges.length ? p : { ...p, badges: [...has] }
}

export function addXp(p: Profile, xp: number, ms: number): Profile {
  const day = dayKey(ms)
  return { ...p, xp: p.xp + xp, days: { ...p.days, [day]: (p.days[day] ?? 0) + xp } }
}

// ── Quiz à répétition espacée ────────────────────────────────────────────

const INTERVALS = [0, 0, 1, 3, 7, 16]

export function learn(p: Profile, concepts: string[], today: number): Profile {
  const boxes = { ...p.boxes }
  for (const k of concepts) if (!boxes[k]) boxes[k] = { box: 1, due: today }
  return { ...p, boxes }
}

export function review(p: Profile, concept: string, isRight: boolean, today: number): Profile {
  const cur = p.boxes[concept] ?? { box: 1, due: today }
  const box = isRight ? Math.min(5, cur.box + 1) : 1
  return { ...p, boxes: { ...p.boxes, [concept]: { box, due: today + (INTERVALS[box] ?? 16) } } }
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

function nameOf(key: string) {
  return LESSONS[key]!.title.split(' — ')[0]!
}

function shortOf(key: string) {
  const t = LESSONS[key]!.title
  return t.split(' — ')[1] ?? t
}

function distractors(correct: string, pool: string[], map: (k: string) => string, n = 2) {
  const out: string[] = []
  for (let tries = 0; out.length < n && tries < 60; tries++) {
    const text = map(pick(pool))
    if (text !== correct && !out.includes(text)) out.push(text)
  }
  return out
}

function shuffleIn(correct: string, wrong: string[]) {
  const options = [...wrong]
  const answer = Math.floor(Math.random() * (options.length + 1))
  options.splice(answer, 0, correct)
  return { options, answer }
}

export function makeQuiz(p: Profile, today: number): Quiz | null {
  const known = p.seen.filter(k => LESSONS[k] && k !== 'mcp')
  if (known.length === 0) return null
  const due = known.filter(k => (p.boxes[k]?.due ?? today) <= today)
  const sorted = (due.length ? due : known).sort((a, b) => (p.boxes[a]?.box ?? 1) - (p.boxes[b]?.box ?? 1))
  const concept = pick(sorted.slice(0, 4))
  const entry = LESSONS[concept]!
  const family = Object.keys(LESSONS).filter(k => k !== concept && k !== 'mcp' && LESSONS[k]!.family === entry.family)
  const pool = family.length >= 4 ? family : Object.keys(LESSONS).filter(k => k !== concept && k !== 'mcp')

  const flagTable = FLAGS[concept]
  const kinds: QuizKind[] = ['purpose', 'reverse']
  if (flagTable && Object.keys(flagTable).length >= 3) kinds.push('flag', 'flag')
  const kind = pick(kinds)

  if (kind === 'flag' && flagTable) {
    const flags = Object.keys(flagTable)
    const flag = pick(flags)
    const correct = flagTable[flag]!
    const wrong = distractors(correct, flags, f => flagTable[f]!)
    return { concept, kind, question: `Dans \`${concept} ${flag}\`, que fait ${flag} ?`, ...shuffleIn(correct, wrong), picked: null, explain: `${flag} : ${correct}.` }
  }
  if (kind === 'reverse') {
    const correct = nameOf(concept)
    const wrong = distractors(correct, pool, nameOf)
    return { concept, kind, question: `Quelle notion pour « ${shortOf(concept)} » ?`, ...shuffleIn(correct, wrong), picked: null, explain: entry.what }
  }
  const correct = shortOf(concept)
  const wrong = distractors(correct, pool, shortOf)
  return { concept, kind: 'purpose', question: `À quoi sert ${nameOf(concept)} ?`, ...shuffleIn(correct, wrong), picked: null, explain: entry.what }
}
