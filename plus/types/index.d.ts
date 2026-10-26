export type TokenKind = 'bin' | 'sub' | 'flag' | 'arg' | 'path' | 'op' | 'str' | 'var'
export type Token = { text: string; kind: TokenKind }

export type Coach = { status: 'idle' | 'loading' | 'done' | 'error'; text: string }

export type Lesson = {
  id: string
  kind: 'tool' | 'prof'
  tool: string
  icon: string
  title: string
  what: string
  tip: string
  raw: string
  tokens: Token[]
  flags: { flag: string; text: string }[]
  extras: string[]
  newConcepts: string[]
  diff: string | null
  coach: Coach
  isRisky: boolean
  isDone: boolean
  isError: boolean
  xp: number
  combo: number
}

export type Leitner = { box: number; due: number }
export type QuestState = { id: string; progress: number; done: boolean }
export type Settings = { sound: boolean; band: boolean; coach: boolean; prof: boolean }

export type Profile = {
  xp: number
  actions: number
  seen: string[]
  badges: string[]
  quizRight: number
  quizTotal: number
  boxes: Record<string, Leitner>
  days: Record<string, number>
  streak: { last: string; count: number; best: number }
  quests: { date: string; items: QuestState[] }
  bestCombo: number
  risky: number
  decoded: number
  settings: Settings
}

export type QuizKind = 'purpose' | 'reverse' | 'flag'

export type Quiz = {
  concept: string
  kind: QuizKind
  question: string
  options: string[]
  answer: number
  picked: number | null
  explain: string
}

export type Tab = 'live' | 'codex' | 'quests' | 'quiz' | 'stats'

export type Session = {
  tab: Tab
  codexPick: string | null
  combo: number
  coachUsed: number
  turn: { actions: number; fresh: number; xp: number }
}

declare module 'claude-code' {
  interface PluginState {
    'vigie-plus': {
      feed: Shaped<Lesson[]>
      profile: Shaped<Profile>
      quiz: Shaped<Quiz | null>
      session: Shaped<Session>
    }
  }
}
