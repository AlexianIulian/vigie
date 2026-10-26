'use strict';
// Narration: turns a raw hook payload into one plain sentence a non-developer can read,
// in French and English, plus optional detail. Deterministic, offline, free.

const { displayPath, truncate, firstLine, hostOf, countLines } = require('./util');
const { explainCommand } = require('./shell');

const T = (fr, en) => ({ fr, en });
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const q = (s, n = 70) => `« ${truncate(flat(s), n)} »`;
const qe = (s, n = 70) => `"${truncate(flat(s), n)}"`;
const plural = (n, fr1, frN, en1, enN) => T(`${n} ${n > 1 ? frN : fr1}`, `${n} ${n > 1 ? enN : en1}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const human = (s) => String(s || '').replace(/[_-]+/g, ' ').trim();

const KIND = {
  Read: 'read', NotebookRead: 'read', LS: 'read',
  Write: 'write', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'exec', PowerShell: 'exec', BashOutput: 'exec', KillShell: 'exec', KillBash: 'exec',
  Grep: 'search', Glob: 'search', ToolSearch: 'search',
  WebSearch: 'web', WebFetch: 'web',
  Agent: 'agent', Task: 'agent', SendMessage: 'agent',
  TodoWrite: 'plan', TaskCreate: 'plan', TaskUpdate: 'plan', TaskList: 'plan', TaskGet: 'plan', EnterPlanMode: 'plan', ExitPlanMode: 'plan',
  AskUserQuestion: 'ask', Skill: 'skill', SlashCommand: 'skill',
};

function kindOf(tool) {
  if (!tool) return 'other';
  if (tool.startsWith('mcp__')) return 'mcp';
  return KIND[tool] || 'other';
}

function mcpNames(tool) {
  const parts = tool.split('__');
  return { server: human(parts[1]), action: human(parts.slice(2).join(' ')) };
}

/** Sentence for a tool call that is about to run (PreToolUse). */
function describeCall(tool, input = {}, cwd = '') {
  const file = input.file_path || input.notebook_path || input.path;
  const rel = file ? displayPath(file, cwd) : '';
  const out = { title: null, detail: null, steps: null, intent: null };
  switch (tool) {
    case 'Read': {
      const range = input.offset || input.limit ? T(` (lignes ${input.offset || 1}–${(input.offset || 1) + (input.limit || 0)})`, ` (lines ${input.offset || 1}–${(input.offset || 1) + (input.limit || 0)})`) : T('', '');
      out.title = T(`Lit ${rel}${range.fr}`, `Reads ${rel}${range.en}`);
      break;
    }
    case 'Write':
      out.title = T(`Écrit le fichier ${rel}`, `Writes ${rel}`);
      if (typeof input.content === 'string') {
        const n = countLines(input.content);
        out.detail = plural(n, 'ligne', 'lignes', 'line', 'lines');
      }
      break;
    case 'Edit':
      out.title = T(`Modifie ${rel}`, `Edits ${rel}`);
      if (input.old_string != null) {
        out.detail = T(`Remplace ${q(firstLine(input.old_string, 60) || '…')} par ${q(firstLine(input.new_string, 60) || '(rien)')}${input.replace_all ? ' partout' : ''}`, `Replaces ${qe(firstLine(input.old_string, 60) || '…')} with ${qe(firstLine(input.new_string, 60) || '(nothing)')}${input.replace_all ? ' everywhere' : ''}`);
      }
      break;
    case 'MultiEdit': {
      const n = (input.edits || []).length;
      out.title = T(`Modifie ${rel} (${n} changement${n > 1 ? 's' : ''})`, `Edits ${rel} (${n} change${n > 1 ? 's' : ''})`);
      break;
    }
    case 'NotebookEdit':
      out.title = T(`Modifie le notebook ${rel}`, `Edits the notebook ${rel}`);
      break;
    case 'LS':
      out.title = T(`Liste le dossier ${rel || '.'}`, `Lists the folder ${rel || '.'}`);
      break;
    case 'Bash':
    case 'PowerShell': {
      const e = explainCommand(input.command || '');
      const bg = input.run_in_background ? T(' (en arrière-plan)', ' (in the background)') : T('', '');
      out.title = T(`${cap(e.fr)}${bg.fr}`, `${cap(e.en)}${bg.en}`);
      out.steps = e.steps.map((s) => ({ cmd: truncate(s.cmd, 200), fr: s.fr, en: s.en }));
      if (input.description) out.intent = truncate(String(input.description), 200);
      break;
    }
    case 'BashOutput':
      out.title = T("Consulte la sortie d'une commande en arrière-plan", 'Checks the output of a background command');
      break;
    case 'KillShell':
    case 'KillBash':
      out.title = T('Arrête une commande en arrière-plan', 'Stops a background command');
      break;
    case 'Grep': {
      const dp = input.path ? displayPath(input.path, cwd) : '.';
      const where = dp !== '.' ? T(` dans ${dp}`, ` in ${dp}`) : T(' dans le projet', ' in the project');
      const only = input.glob ? T(` (fichiers ${input.glob})`, ` (${input.glob} files)`) : T('', '');
      out.title = T(`Cherche ${q(input.pattern, 50)}${where.fr}${only.fr}`, `Searches for ${qe(input.pattern, 50)}${where.en}${only.en}`);
      break;
    }
    case 'Glob':
      out.title = T(`Cherche les fichiers ${q(input.pattern, 50)}`, `Looks for files matching ${qe(input.pattern, 50)}`);
      break;
    case 'ToolSearch':
      out.title = T('Charge des outils supplémentaires', 'Loads extra tools');
      break;
    case 'WebSearch':
      out.title = T(`Recherche sur le web : ${q(input.query)}`, `Searches the web: ${qe(input.query)}`);
      break;
    case 'WebFetch':
      out.title = T(`Consulte la page ${hostOf(input.url)}`, `Opens the page ${hostOf(input.url)}`);
      if (input.prompt) out.detail = T(`Pour : ${truncate(input.prompt, 140)}`, `To: ${truncate(input.prompt, 140)}`);
      break;
    case 'Agent':
    case 'Task': {
      const who = input.subagent_type ? ` (${input.subagent_type})` : '';
      out.title = T(`Confie une tâche à un sous-agent${who} : ${q(input.description || input.prompt, 60)}`, `Hands a task to a sub-agent${who}: ${qe(input.description || input.prompt, 60)}`);
      if (input.prompt) out.detail = T(truncate(input.prompt, 300), truncate(input.prompt, 300));
      break;
    }
    case 'SendMessage':
      out.title = T('Envoie un message à un sous-agent', 'Sends a message to a sub-agent');
      break;
    case 'TodoWrite': {
      const todos = input.todos || [];
      const done = todos.filter((t) => t.status === 'completed').length;
      out.title = T(`Met à jour sa liste de tâches (${done}/${todos.length} faites)`, `Updates its task list (${done}/${todos.length} done)`);
      break;
    }
    case 'TaskCreate':
      out.title = T(`Ajoute une tâche : ${q(input.subject, 60)}`, `Adds a task: ${qe(input.subject, 60)}`);
      break;
    case 'TaskUpdate':
      out.title = input.status === 'completed' ? T('Coche une tâche terminée', 'Ticks off a task') : input.status === 'in_progress' ? T('Commence une tâche', 'Starts a task') : T('Met à jour une tâche', 'Updates a task');
      break;
    case 'TaskList':
    case 'TaskGet':
      out.title = T('Relit sa liste de tâches', 'Reviews its task list');
      break;
    case 'EnterPlanMode':
      out.title = T('Prépare un plan avant d’agir', 'Drafts a plan before acting');
      break;
    case 'ExitPlanMode':
      out.title = T('Te présente son plan', 'Presents its plan to you');
      break;
    case 'AskUserQuestion': {
      const qs = input.questions || [];
      out.title = T(`Te pose ${qs.length > 1 ? `${qs.length} questions` : 'une question'}`, `Asks you ${qs.length > 1 ? `${qs.length} questions` : 'a question'}`);
      if (qs[0]?.question) out.detail = T(qs[0].question, qs[0].question);
      break;
    }
    case 'Skill':
      out.title = T(`Utilise la compétence ${q(input.skill || input.command, 40)}`, `Uses the skill ${qe(input.skill || input.command, 40)}`);
      break;
    case 'SlashCommand':
      out.title = T(`Lance la commande ${input.command || ''}`, `Runs the command ${input.command || ''}`);
      break;
    default:
      if (tool && tool.startsWith('mcp__')) {
        const { server, action } = mcpNames(tool);
        out.title = T(`Utilise « ${action} » via le service ${server}`, `Uses "${action}" through ${server}`);
      } else {
        out.title = T(`Utilise l'outil ${tool}`, `Uses the tool ${tool}`);
      }
  }
  return out;
}

/** Short sentence for a finished tool call (PostToolUse). */
function describeResult(tool, input = {}, resp, durationMs) {
  const r = resp && typeof resp === 'object' ? resp : {};
  const t = durationMs != null ? T(` en ${fmtMs(durationMs)}`, ` in ${fmtMs(durationMs)}`) : T('', '');
  switch (tool) {
    case 'Read': {
      const n = r.file?.numLines ?? r.file?.totalLines;
      return n != null ? T(`${n} ligne${n > 1 ? 's' : ''} lue${n > 1 ? 's' : ''}`, `${n} line${n > 1 ? 's' : ''} read`) : T('Lu', 'Read');
    }
    case 'Write':
      return r.type === 'create' ? T('Fichier créé', 'File created') : T('Fichier réécrit', 'File rewritten');
    case 'Edit':
    case 'MultiEdit': {
      const { added, removed } = diffStats(r.structuredPatch);
      return T(`+${added} / −${removed} lignes`, `+${added} / −${removed} lines`);
    }
    case 'Bash':
    case 'PowerShell': {
      if (r.interrupted) return T('Interrompu', 'Interrupted');
      if (r.backgroundTaskId || input.run_in_background) return T('Lancé en arrière-plan', 'Started in the background');
      const line = firstLine(r.stdout || '', 90);
      return line ? T(`Terminé${t.fr} : ${line}`, `Done${t.en}: ${line}`) : T(`Terminé${t.fr}`, `Done${t.en}`);
    }
    case 'Grep': {
      const n = r.numLines ?? r.numFiles ?? (Array.isArray(r.filenames) ? r.filenames.length : null);
      return n != null ? T(`${n} résultat${n > 1 ? 's' : ''}`, `${n} result${n > 1 ? 's' : ''}`) : T('Recherche terminée', 'Search done');
    }
    case 'Glob': {
      const n = r.numFiles ?? (Array.isArray(r.filenames) ? r.filenames.length : null);
      return n != null ? T(`${n} fichier${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''}`, `${n} file${n > 1 ? 's' : ''} found`) : T('Recherche terminée', 'Search done');
    }
    case 'Agent':
    case 'Task':
      if (r.status === 'async_launched' || r.isAsync) return T('Sous-agent lancé en parallèle', 'Sub-agent running in parallel');
      return T(`Sous-agent terminé${t.fr}`, `Sub-agent done${t.en}`);
    case 'WebFetch':
    case 'WebSearch':
      return T(`Fait${t.fr}`, `Done${t.en}`);
    default:
      return T(`Fait${t.fr}`, `Done${t.en}`);
  }
}

function describeFailure(error, isInterrupt) {
  if (isInterrupt) return T('Interrompu par toi', 'Interrupted by you');
  const e = firstLine(String(error || ''), 140);
  return T(`Échec : ${e || 'erreur inconnue'}`, `Failed: ${e || 'unknown error'}`);
}

function diffStats(patch) {
  let added = 0;
  let removed = 0;
  for (const h of Array.isArray(patch) ? patch : []) {
    for (const l of h.lines || []) {
      if (l.startsWith('+')) added++;
      else if (l.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

function fmtMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

/** Sentences for non-tool events. */
function describeEvent(p) {
  switch (p.hook_event_name) {
    case 'SessionStart': {
      const src = { startup: T('Session démarrée', 'Session started'), resume: T('Session reprise', 'Session resumed'), clear: T('Conversation effacée, nouvelle session', 'Conversation cleared, new session'), compact: T('Session reprise après compression', 'Session resumed after compaction') };
      return src[p.source] || T('Session démarrée', 'Session started');
    }
    case 'UserPromptSubmit':
      if (isSystemPrompt(p.prompt)) return T('Une tâche en arrière-plan a terminé et Claude reprend', 'A background task finished and Claude resumes');
      return T(`Tu as demandé : ${q(p.prompt, 160)}`, `You asked: ${qe(p.prompt, 160)}`);
    case 'SubagentStart':
      return T(`Un sous-agent${p.agent_type ? ` (${p.agent_type})` : ''} se met au travail`, `A sub-agent${p.agent_type ? ` (${p.agent_type})` : ''} starts working`);
    case 'SubagentStop':
      return T(`Le sous-agent${p.agent_type ? ` (${p.agent_type})` : ''} a terminé`, `The sub-agent${p.agent_type ? ` (${p.agent_type})` : ''} finished`);
    case 'Stop':
      return T('Claude a fini et attend ta suite', 'Claude finished and is waiting for you');
    case 'StopFailure':
      return T("Claude s'est arrêté sur une erreur", 'Claude stopped on an error');
    case 'Notification':
      return T(`Claude a besoin de toi : ${truncate(p.message || '', 140)}`, `Claude needs you: ${truncate(p.message || '', 140)}`);
    case 'PreCompact':
      return T('La conversation est trop longue : Claude la résume pour continuer', 'The conversation is too long: Claude summarises it to continue');
    case 'PostCompact':
      return T('Résumé de la conversation terminé', 'Conversation summary done');
    case 'PermissionDenied':
      return T(`Action refusée : ${p.tool_name || ''}`, `Action denied: ${p.tool_name || ''}`);
    case 'SessionEnd':
      return T('Session terminée', 'Session ended');
    default:
      return T(human(p.hook_event_name), human(p.hook_event_name));
  }
}

/** Messages Claude Code injects as if typed by the user (background task results, etc.). */
function isSystemPrompt(prompt) {
  return /^\s*<(task-notification|system-reminder|local-command-stdout|command-name|bash-notification)\b/.test(String(prompt || ''));
}

/** Files a call touches, for the "files" panel. */
function filesOf(tool, input = {}) {
  const f = input.file_path || input.notebook_path;
  if (f) return [f];
  return [];
}

module.exports = { isSystemPrompt, describeCall, describeResult, describeFailure, describeEvent, kindOf, filesOf, diffStats, fmtMs };
