import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'vigie-plus',
  component: 'Pane',
  requestId: 'vigie-plus',
  props: {
    title: '⚓ Vigie+',
    isFocused: false,
    bodyColumns: 52,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const DONE = { answer: '', reason: 'answer' } as never
// 26 octobre 2026, midi
const NOW = 1793012400000

type On = Parameters<Parameters<typeof test>[1]>[1]
type Dollar = Parameters<Parameters<typeof test>[1]>[0]

function engine(on: On, store: Record<string, unknown> = {}) {
  on('command.register', () => ({ value: { command: 'vigie-plus' } }))
  on('tool.register', () => ({ value: { name: 'mcp__vigie-plus__lecon' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Lance un outil inconnu en mode rapide. Astuce : ajoute --help.', usage: {} } }))
  mock.store(on, store)
  mock.clock(on, { now: NOW })
}

async function start($: Dollar) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

async function text(ui: { find: (q: never) => Promise<{ text?: string } | undefined> }, re: RegExp) {
  return (await ui.find({ type: 'Text', text: re } as never))?.text
}

test('une commande est découpée, ses options expliquées, sur chaque surface', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls -la ~/projet | grep -i "a|b" && git status' })
  await $.turn.complete(DONE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await text(ui, /ls — lister un dossier/)).toBeTruthy()
    expect(await text(ui, /format long/)).toBeTruthy()
    expect(await text(ui, /fichiers cachés/)).toBeTruthy()
    expect(await text(ui, /ignore majuscules/)).toBeTruthy()
    expect(await text(ui, /■ programme/)).toBeTruthy()
    expect(await text(ui, /Nouvelles notions au Codex/)).toBeTruthy()
    expect(await text(ui, /Un quiz t'attend/)).toBeTruthy()
    await ui.unmount()
  }
})

test('chaque onglet se dessine sur chaque surface', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git log --oneline | head -n 5' })
  await $.tool.call({ tool: 'Edit', file_path: '/x/a.ts', old_string: 'const a = 1', new_string: 'const a = 2' })
  await $.turn.complete(DONE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await text(ui, /ce qui change/)).toBeTruthy()
    await ui.press({ key: 'tab-codex' })
    expect(await text(ui, /Codex · \d+\/\d+ notions/)).toBeTruthy()
    await ui.press({ key: 'cx-head' })
    expect(await text(ui, /Mémoire/)).toBeTruthy()
    await ui.press({ key: 'tab-quests' })
    expect(await text(ui, /Quêtes du jour/)).toBeTruthy()
    await ui.press({ key: 'tab-quiz' })
    expect(await text(ui, /Boîtes de révision/)).toBeTruthy()
    await ui.press({ key: 'tab-stats' })
    expect(await text(ui, /14 derniers jours/)).toBeTruthy()
    expect(await text(ui, /Badges/)).toBeTruthy()
    await ui.press({ key: 'tab-live' })
    await ui.unmount()
  }
})

test('répondre au quiz fait progresser la mémoire', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await $.turn.complete(DONE)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-quiz' })
  await ui.press({ key: 'q0' })
  expect(await text(ui, /Bien vu|Pas cette fois/)).toBeTruthy()
  expect(await text(ui, /Mémoire de/)).toBeTruthy()
  await ui.unmount()
})

test('une action sensible est signalée en rouge', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /Action sensible/)).toBeTruthy()
  expect(await text(ui, /supprime aussi le contenu des dossiers/)).toBeTruthy()
  await ui.unmount()
})

test('le coach décode une commande inconnue', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'mystere --turbo' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /Commande shell/)).toBeTruthy()
  await ui.press({ key: 'decode' })
  expect(await text(ui, /Le coach décode/)).toBeTruthy()
  expect(await text(ui, /Astuce : ajoute --help/)).toBeTruthy()
  await ui.unmount()
})

test('le mode prof affiche une leçon envoyée par Claude', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'mcp__vigie-plus__lecon', titre: 'Le tuyau |', explication: 'Il relie deux commandes.', astuce: 'Lis-le « puis ».', exemple: 'ls | wc -l' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /LEÇON DU PROF/)).toBeTruthy()
  expect(await text(ui, /Le tuyau \|/)).toBeTruthy()
  await ui.unmount()
})

test('le bandeau au-dessus du prompt montre l’action en cours', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/x/config.js' })

  const ui = await $.ui.mount({
    plugin: 'vigie-plus',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 100 },
  } as never)
  expect(await text(ui, /Read — Claude lit un fichier · config\.js/)).toBeTruthy()
  await ui.unmount()
})

test('un profil de la v1 est repris sans perte', async ($, on) => {
  engine(on, { profile: { xp: 120, actions: 14, seen: ['ls', 'grep'], badges: ['premier-pas'], quizRight: 2, quizTotal: 3 } })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /120\/150 XP/)).toBeTruthy()
  await ui.press({ key: 'tab-codex' })
  expect(await text(ui, /Codex · 2\//)).toBeTruthy()
  await ui.unmount()
})
