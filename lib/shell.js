'use strict';
// Shell command explainer.
// Turns "git add -A && git commit -m 'fix' && git push --force" into
// "prépare tous les fichiers, puis enregistre une version « fix », puis envoie de force…".
// Pure string work, no execution, no network.

const { truncate, hostOf, basename } = require('./util');

const T = (fr, en) => ({ fr, en });

// ---------- parsing ----------

/** Split a command line into segments joined by && || ; | & and newlines, respecting quotes. */
function splitSegments(cmd) {
  let src = String(cmd || '');
  let heredoc = false;
  const firstNl = src.indexOf('\n');
  const head = firstNl === -1 ? src : src.slice(0, firstNl);
  if (/<<-?\s*['"]?[A-Za-z_]+['"]?/.test(head)) {
    // A heredoc's body is data, not commands: only the first line is a command.
    src = head;
    heredoc = true;
  }
  const segs = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    const p = src[i - 1];
    if (quote) {
      cur += c;
      if (c === quote && p !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '\\' && n === '\n') {
      i++;
      cur += ' ';
      continue;
    }
    if ((c === '&' && n === '&') || (c === '|' && n === '|')) {
      segs.push({ text: cur.trim(), sep: c + n });
      cur = '';
      i++;
      continue;
    }
    if (c === '&' && (p === '>' || n === '>' || p === '<')) {
      cur += c; // 2>&1, &>file
      continue;
    }
    if (c === ';' || c === '\n') {
      segs.push({ text: cur.trim(), sep: ';' });
      cur = '';
      continue;
    }
    if (c === '|') {
      segs.push({ text: cur.trim(), sep: '|' });
      cur = '';
      continue;
    }
    if (c === '&') {
      segs.push({ text: cur.trim(), sep: '&' });
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) segs.push({ text: cur.trim(), sep: null });
  const out = segs.filter((s) => s.text);
  return { segments: out, heredoc };
}

/** Tokenise one segment: whitespace-separated words, quotes removed, redirections dropped. */
function tokenize(seg) {
  const toks = [];
  let cur = '';
  let quote = null;
  let had = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      had = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur || had) toks.push(cur);
      cur = '';
      had = false;
      continue;
    }
    cur += c;
  }
  if (cur || had) toks.push(cur);
  // Drop redirections like > out.txt, 2>&1, < in.txt
  const clean = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\d*>{1,2}&?\d*$|^<$|^&>$/.test(t)) {
      if (!/&\d$/.test(t)) i++; // skip the file after > or <
      continue;
    }
    if (/^\d*>{1,2}.+|^<.+/.test(t)) continue;
    clean.push(t);
  }
  return clean;
}

// ---------- helpers ----------

const q = (s) => `« ${truncate(String(s), 60)} »`;
const qe = (s) => `"${truncate(String(s), 60)}"`;
const args = (toks) => toks.filter((t) => !t.startsWith('-'));
const has = (toks, ...flags) =>
  toks.some((t) => flags.includes(t) || flags.some((f) => /^-[a-zA-Z]$/.test(f) && /^-[a-zA-Z]+$/.test(t) && t.includes(f[1])));

function listFr(items, max = 3) {
  const xs = items.slice(0, max).map((x) => truncate(x, 50));
  const more = items.length > max ? ` (+${items.length - max})` : '';
  if (xs.length <= 1) return (xs[0] || '') + more;
  return xs.slice(0, -1).join(', ') + ' et ' + xs[xs.length - 1] + more;
}
function listEn(items, max = 3) {
  const xs = items.slice(0, max).map((x) => truncate(x, 50));
  const more = items.length > max ? ` (+${items.length - max})` : '';
  if (xs.length <= 1) return (xs[0] || '') + more;
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] + more;
}
const L = (items) => T(listFr(items), listEn(items));

const SCRIPT_NAMES = {
  test: T('les tests', 'the tests'),
  build: T('la compilation (build)', 'the build'),
  dev: T('le serveur de développement', 'the dev server'),
  start: T("l'application", 'the app'),
  lint: T("l'analyse du code (lint)", 'the linter'),
  format: T('le reformatage du code', 'the code formatter'),
  typecheck: T('la vérification des types', 'the type check'),
  deploy: T('le déploiement', 'the deployment'),
};

function scriptLabel(name) {
  const k = SCRIPT_NAMES[name];
  return k || T(`le script ${q(name)}`, `the script ${qe(name)}`);
}

// ---------- package managers ----------

function pkgManager(prog, rest) {
  const sub = rest[0];
  const a = args(rest.slice(1));
  const dev = has(rest, '-D', '--save-dev', '--dev');
  const global = has(rest, '-g', '--global');
  switch (sub) {
    case undefined:
      return prog === 'npm' ? T('affiche l’aide de npm', 'shows npm help') : T('installe les dépendances du projet', 'installs project dependencies');
    case 'install':
    case 'i':
    case 'add':
      if (!a.length) return T('installe les dépendances du projet', 'installs the project dependencies');
      if (global) return T(`installe ${listFr(a)} sur toute ta machine`, `installs ${listEn(a)} machine-wide`);
      return T(`ajoute ${listFr(a)} au projet${dev ? ' (outil de développement)' : ''}`, `adds ${listEn(a)} to the project${dev ? ' (dev tool)' : ''}`);
    case 'ci':
      return T('réinstalle proprement les dépendances', 'does a clean install of dependencies');
    case 'uninstall':
    case 'remove':
    case 'rm':
    case 'un':
      return T(`retire ${listFr(a)} du projet`, `removes ${listEn(a)} from the project`);
    case 'run':
    case 'run-script': {
      const s = scriptLabel(a[0] || '?');
      return T(`lance ${s.fr}`, `runs ${s.en}`);
    }
    case 'test':
    case 't':
      return T('lance les tests', 'runs the tests');
    case 'start':
      return T("démarre l'application", 'starts the app');
    case 'build':
      return T('lance la compilation (build)', 'runs the build');
    case 'dev':
      return T('lance le serveur de développement', 'starts the dev server');
    case 'publish':
      return T('publie le paquet sur le registre public', 'publishes the package publicly');
    case 'init':
    case 'create':
      return T('crée un nouveau projet', 'creates a new project');
    case 'update':
    case 'upgrade':
    case 'up':
      return T('met à jour les dépendances', 'updates dependencies');
    case 'audit':
      return T('vérifie les failles de sécurité des dépendances', 'checks dependencies for vulnerabilities');
    case 'outdated':
      return T('liste les dépendances obsolètes', 'lists outdated dependencies');
    case 'exec':
    case 'dlx':
    case 'x':
      return T(`exécute l’outil ${q(a[0] || '?')}`, `runs the tool ${qe(a[0] || '?')}`);
    case 'version':
    case '-v':
    case '--version':
      return T(`affiche la version de ${prog}`, `shows the ${prog} version`);
    case 'login':
      return T(`se connecte au registre ${prog}`, `logs in to the ${prog} registry`);
    default:
      if (prog !== 'npm' && SCRIPT_NAMES[sub]) {
        const s = scriptLabel(sub);
        return T(`lance ${s.fr}`, `runs ${s.en}`);
      }
      return T(`lance ${prog} ${sub}`, `runs ${prog} ${sub}`);
  }
}

// ---------- git ----------

function git(rest) {
  // skip global options like -C dir, -c k=v
  let i = 0;
  while (rest[i] && rest[i].startsWith('-')) i += rest[i] === '-C' || rest[i] === '-c' ? 2 : 1;
  const sub = rest[i];
  const r = rest.slice(i + 1);
  const a = args(r);
  const force = has(r, '--force', '-f', '--force-with-lease');
  switch (sub) {
    case 'status':
      return T("regarde l'état des fichiers (modifiés, nouveaux…)", 'checks which files changed');
    case 'diff':
      return T('affiche les modifications en cours', 'shows the current changes');
    case 'log':
      return T("affiche l'historique des versions", 'shows the commit history');
    case 'show':
      return T("affiche le détail d'une version", 'shows a commit');
    case 'add':
      return has(r, '-A', '--all', '.') || a.includes('.')
        ? T('prépare tous les fichiers pour la prochaine version', 'stages all files')
        : T(`prépare ${listFr(a)} pour la prochaine version`, `stages ${listEn(a)}`);
    case 'commit': {
      const mi = r.findIndex((t) => t === '-m' || t === '--message');
      const msg = mi >= 0 ? r[mi + 1] : r.find((t) => t.startsWith('-m') && t.length > 2)?.slice(2);
      return msg
        ? T(`enregistre une version : ${q(msg)}`, `commits a version: ${qe(msg)}`)
        : T('enregistre une version (commit)', 'commits a version');
    }
    case 'push':
      if (force) return T('envoie de force sur le dépôt distant en écrasant son historique', 'force-pushes, overwriting the remote history');
      return T('envoie les versions sur le dépôt distant (GitHub…)', 'pushes commits to the remote (GitHub…)');
    case 'pull':
      return T('récupère et fusionne les changements distants', 'pulls and merges remote changes');
    case 'fetch':
      return T('récupère les changements distants sans les appliquer', 'fetches remote changes');
    case 'clone':
      return T(`télécharge le dépôt ${q(a[0] || '?')}`, `clones ${qe(a[0] || '?')}`);
    case 'checkout':
      if (r.includes('--')) return T(`annule les modifications de ${listFr(r.slice(r.indexOf('--') + 1))}`, `discards changes to ${listEn(r.slice(r.indexOf('--') + 1))}`);
      if (has(r, '-b')) return T(`crée la branche ${q(a[0] || '?')}`, `creates branch ${qe(a[0] || '?')}`);
      return T(`passe sur ${q(a[0] || '?')}`, `switches to ${qe(a[0] || '?')}`);
    case 'switch':
      return has(r, '-c') ? T(`crée la branche ${q(a[0] || '?')}`, `creates branch ${qe(a[0] || '?')}`) : T(`passe sur la branche ${q(a[0] || '?')}`, `switches to branch ${qe(a[0] || '?')}`);
    case 'branch':
      if (has(r, '-D', '-d', '--delete')) return T(`supprime la branche ${q(a[0] || '?')}`, `deletes branch ${qe(a[0] || '?')}`);
      return a.length ? T(`crée la branche ${q(a[0])}`, `creates branch ${qe(a[0])}`) : T('liste les branches', 'lists branches');
    case 'merge':
      return T(`fusionne ${q(a[0] || '?')} dans la branche actuelle`, `merges ${qe(a[0] || '?')} into the current branch`);
    case 'rebase':
      return T("réécrit l'historique en rejouant les versions", 'rewrites history by replaying commits');
    case 'reset':
      if (has(r, '--hard')) return a.length ? T(`revient à la version ${q(a[0])} et efface toutes les modifications non enregistrées`, `goes back to ${qe(a[0])} and discards all uncommitted changes`) : T('efface toutes les modifications non enregistrées', 'discards all uncommitted changes');
      return T('retire des fichiers de la prochaine version', 'unstages changes');
    case 'restore':
      return T(`annule les modifications de ${listFr(a)}`, `discards changes to ${listEn(a)}`);
    case 'stash':
      return a[0] === 'pop' || a[0] === 'apply' ? T('réapplique les modifications mises de côté', 'reapplies stashed changes') : T('met de côté les modifications en cours', 'stashes the current changes');
    case 'clean':
      return T('supprime les fichiers non suivis par git', 'deletes untracked files');
    case 'rm':
      return T(`supprime ${listFr(a)} du dépôt`, `removes ${listEn(a)} from the repo`);
    case 'mv':
      return T(`renomme ${q(a[0] || '?')} en ${q(a[1] || '?')}`, `renames ${qe(a[0] || '?')} to ${qe(a[1] || '?')}`);
    case 'revert':
      return T('annule une version en créant une version inverse', 'reverts a commit');
    case 'cherry-pick':
      return T('copie une version depuis une autre branche', 'cherry-picks a commit');
    case 'tag':
      return a.length ? T(`marque la version ${q(a[0])}`, `tags ${qe(a[0])}`) : T('liste les étiquettes', 'lists tags');
    case 'init':
      return T('crée un dépôt git', 'initialises a git repository');
    case 'remote':
      return T('gère les dépôts distants', 'manages remotes');
    case 'blame':
      return T('montre qui a écrit chaque ligne', 'shows who wrote each line');
    case 'config':
      return T('modifie la configuration git', 'changes git config');
    case 'worktree':
      return T('gère des copies de travail parallèles', 'manages worktrees');
    default:
      return T(`lance git ${sub || ''}`.trim(), `runs git ${sub || ''}`.trim());
  }
}

function gh(rest) {
  const [a, b] = rest;
  const key = `${a} ${b}`;
  const map = {
    'pr create': T('ouvre une pull request', 'opens a pull request'),
    'pr merge': T('fusionne une pull request', 'merges a pull request'),
    'pr view': T('consulte une pull request', 'views a pull request'),
    'pr list': T('liste les pull requests', 'lists pull requests'),
    'pr checkout': T('récupère une pull request en local', 'checks out a pull request'),
    'issue create': T('crée un ticket (issue)', 'creates an issue'),
    'issue list': T('liste les tickets', 'lists issues'),
    'repo create': T('crée un dépôt GitHub', 'creates a GitHub repository'),
    'repo clone': T('télécharge un dépôt GitHub', 'clones a GitHub repository'),
    'release create': T('publie une release GitHub', 'publishes a GitHub release'),
    'run list': T('liste les exécutions CI', 'lists CI runs'),
    'run view': T('consulte une exécution CI', 'views a CI run'),
    'auth login': T('se connecte à GitHub', 'logs in to GitHub'),
  };
  return map[key] || T(`utilise GitHub CLI (${a || ''} ${b || ''})`.trim(), `uses GitHub CLI (${a || ''} ${b || ''})`.trim());
}

function docker(rest) {
  const sub = rest[0] === 'compose' ? `compose ${rest.find((t, i) => i > 0 && !t.startsWith('-')) || ''}` : rest[0];
  const map = {
    build: T('construit une image Docker', 'builds a Docker image'),
    run: T('lance un conteneur Docker', 'runs a Docker container'),
    ps: T('liste les conteneurs', 'lists containers'),
    exec: T('exécute une commande dans un conteneur', 'runs a command inside a container'),
    stop: T('arrête un conteneur', 'stops a container'),
    rm: T('supprime un conteneur', 'removes a container'),
    rmi: T('supprime une image', 'removes an image'),
    pull: T('télécharge une image', 'pulls an image'),
    push: T('publie une image', 'pushes an image'),
    logs: T("affiche les journaux d'un conteneur", 'shows container logs'),
    'compose up': T('démarre les services Docker', 'starts Docker services'),
    'compose down': T('arrête les services Docker', 'stops Docker services'),
    'compose build': T('construit les services Docker', 'builds Docker services'),
    system: T('nettoie Docker (images et conteneurs inutilisés)', 'prunes Docker'),
  };
  return map[sub] || T(`utilise Docker (${sub || ''})`, `uses Docker (${sub || ''})`);
}

// ---------- the dictionary ----------

function explainTokens(toks) {
  if (!toks.length) return null;
  let i = 0;
  const prefix = { fr: '', en: '' };
  // Leading env assignments: FOO=bar cmd
  while (toks[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
  // Wrappers
  while (toks[i] && ['sudo', 'time', 'nohup', 'exec', 'command', 'env', 'nice', 'timeout', 'doas'].includes(toks[i])) {
    if (toks[i] === 'env' && toks.slice(i + 1).every((t) => t.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t))) break; // bare `env` is the program
    if (toks[i] === 'sudo' || toks[i] === 'doas') {
      prefix.fr = 'avec les droits administrateur, ';
      prefix.en = 'as administrator, ';
    }
    if (toks[i] === 'timeout') i++; // duration
    i++;
    while (toks[i] && toks[i].startsWith('-')) i++;
    while (toks[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
  }
  const progPath = toks[i];
  if (!progPath) return null;
  const prog = basename(progPath).replace(/\.exe$/i, '');
  const rest = toks.slice(i + 1);
  const a = args(rest);
  const r = explainProgram(prog, rest, a, progPath);
  return { fr: prefix.fr + r.fr, en: prefix.en + r.en, prog };
}

function explainProgram(prog, rest, a, progPath) {
  switch (prog) {
    case 'ls':
    case 'dir':
    case 'll':
    case 'exa':
    case 'eza':
      return a.length ? T(`liste le contenu de ${listFr(a)}`, `lists ${listEn(a)}`) : T('liste les fichiers du dossier', 'lists the files');
    case 'tree':
      return T("affiche l'arborescence des dossiers", 'shows the folder tree');
    case 'pwd':
      return T('affiche le dossier courant', 'prints the current folder');
    case 'cd':
      return T(`se place dans ${q(a[0] || '~')}`, `moves into ${qe(a[0] || '~')}`);
    case 'cat':
    case 'bat':
    case 'type':
      if (prog === 'type' && a.length && !a[0].includes('.')) return T(`cherche ce qu'est ${q(a[0])}`, `looks up what ${qe(a[0])} is`);
      return a.length ? T(`affiche le contenu de ${listFr(a)}`, `prints ${listEn(a)}`) : T('affiche du texte', 'prints text');
    case 'head':
      return T(`affiche le début de ${a.length ? listFr(a) : 'la sortie'}`, `shows the start of ${a.length ? listEn(a) : 'the output'}`);
    case 'tail':
      return has(rest, '-f') ? T(`suit en direct ${listFr(a)}`, `follows ${listEn(a)} live`) : T(`affiche la fin de ${a.length ? listFr(a) : 'la sortie'}`, `shows the end of ${a.length ? listEn(a) : 'the output'}`);
    case 'less':
    case 'more':
      return T(`ouvre ${listFr(a)} en lecture`, `pages through ${listEn(a)}`);
    case 'echo':
    case 'printf':
      return T('affiche un texte', 'prints text');
    case 'grep':
    case 'egrep':
    case 'rg':
    case 'ag':
    case 'ack':
    case 'findstr':
      return T(`cherche ${q(a[0] || '?')}${a[1] ? ` dans ${listFr(a.slice(1))}` : ''}`, `searches for ${qe(a[0] || '?')}${a[1] ? ` in ${listEn(a.slice(1))}` : ''}`);
    case 'find':
    case 'fd':
      return has(rest, '-delete') ? T('cherche des fichiers et les supprime', 'finds files and deletes them') : T(`recherche des fichiers${a[0] ? ` dans ${q(a[0])}` : ''}`, `searches for files${a[0] ? ` in ${qe(a[0])}` : ''}`);
    case 'mkdir':
      return T(`crée le dossier ${listFr(a)}`, `creates the folder ${listEn(a)}`);
    case 'touch':
      return T(`crée le fichier ${listFr(a)}`, `creates the file ${listEn(a)}`);
    case 'rm':
    case 'del':
    case 'rd':
    case 'rmdir':
    case 'unlink':
    case 'trash': {
      const rec = has(rest, '-r', '-R', '--recursive', '/s');
      if (prog === 'trash') return T(`met ${listFr(a)} à la corbeille`, `moves ${listEn(a)} to the trash`);
      return rec
        ? T(`supprime définitivement ${listFr(a)}, avec tout ${a.length > 1 ? 'leur' : 'son'} contenu`, `permanently deletes ${listEn(a)} and everything inside`)
        : T(`supprime ${listFr(a)}`, `deletes ${listEn(a)}`);
    }
    case 'mv':
    case 'move':
    case 'ren':
      return T(`déplace ${q(a[0] || '?')} vers ${q(a[a.length - 1] || '?')}`, `moves ${qe(a[0] || '?')} to ${qe(a[a.length - 1] || '?')}`);
    case 'cp':
    case 'copy':
      return T(`copie ${q(a[0] || '?')} vers ${q(a[a.length - 1] || '?')}`, `copies ${qe(a[0] || '?')} to ${qe(a[a.length - 1] || '?')}`);
    case 'ln':
      return T('crée un lien vers un fichier', 'creates a link');
    case 'chmod':
      return T(`change les permissions de ${listFr(a.slice(1))}`, `changes permissions of ${listEn(a.slice(1))}`);
    case 'chown':
      return T(`change le propriétaire de ${listFr(a.slice(1))}`, `changes the owner of ${listEn(a.slice(1))}`);
    case 'wc':
      return T('compte les lignes ou les mots', 'counts lines or words');
    case 'sort':
      return T('trie les lignes', 'sorts lines');
    case 'uniq':
      return T('retire les doublons', 'removes duplicates');
    case 'cut':
    case 'tr':
    case 'awk':
    case 'jq':
      return T('extrait ou transforme du texte', 'extracts or reshapes text');
    case 'sed':
      return has(rest, '-i') ? T(`modifie directement le contenu de ${listFr(a.slice(1)) || 'fichiers'}`, `edits ${listEn(a.slice(1)) || 'files'} in place`) : T('transforme du texte', 'rewrites text');
    case 'xargs':
      return T('applique une commande à chaque élément', 'runs a command for each item');
    case 'tee':
      return T(`écrit la sortie dans ${listFr(a)}`, `writes the output to ${listEn(a)}`);
    case 'diff':
      return T('compare deux fichiers', 'compares two files');
    case 'tar':
      return has(rest, '-x', 'x', 'xf', 'xzf', 'xvf', 'xzvf') ? T('décompresse une archive', 'extracts an archive') : T('crée ou lit une archive', 'creates or reads an archive');
    case 'zip':
    case 'gzip':
      return T('compresse des fichiers', 'compresses files');
    case 'unzip':
    case 'gunzip':
      return T('décompresse une archive', 'extracts an archive');
    case 'curl':
    case 'wget':
    case 'http':
    case 'Invoke-WebRequest':
    case 'iwr': {
      const url = a.find((x) => /^https?:\/\//.test(x)) || a[0] || '';
      const sends = has(rest, '-d', '--data', '--data-binary', '--data-raw', '-F', '--form', '-T', '--upload-file') || /^(POST|PUT|PATCH|DELETE)$/.test(rest[rest.indexOf('-X') + 1] || '');
      return sends
        ? T(`envoie des données à ${hostOf(url) || 'un serveur'}`, `sends data to ${hostOf(url) || 'a server'}`)
        : T(`télécharge depuis ${hostOf(url) || 'Internet'}`, `downloads from ${hostOf(url) || 'the internet'}`);
    }
    case 'ssh':
      return T(`se connecte à la machine distante ${q(a[0] || '?')}`, `connects to the remote machine ${qe(a[0] || '?')}`);
    case 'scp':
    case 'rsync':
      return T('copie des fichiers vers ou depuis une autre machine', 'copies files to or from another machine');
    case 'ping':
      return T(`teste la connexion à ${q(a[0] || '?')}`, `tests the connection to ${qe(a[0] || '?')}`);
    case 'open':
    case 'xdg-open':
    case 'start':
    case 'explorer':
      return T(`ouvre ${q(a[0] || '?')}`, `opens ${qe(a[0] || '?')}`);
    case 'code':
    case 'cursor':
    case 'vim':
    case 'nvim':
    case 'nano':
      return T(`ouvre ${listFr(a)} dans l'éditeur`, `opens ${listEn(a)} in the editor`);
    case 'which':
    case 'where':
    case 'whereis':
      return T(`cherche où est installé ${q(a[0] || '?')}`, `looks for where ${qe(a[0] || '?')} is installed`);
    case 'export':
    case 'set':
    case 'setx':
      return T("définit une variable d'environnement", 'sets an environment variable');
    case 'source':
    case '.':
      return T(`charge les réglages de ${q(a[0] || '?')}`, `loads settings from ${qe(a[0] || '?')}`);
    case 'env':
    case 'printenv':
      return T("affiche les variables d'environnement", 'prints environment variables');
    case 'kill':
    case 'pkill':
    case 'killall':
    case 'taskkill':
    case 'Stop-Process':
      return T('arrête un programme en cours', 'stops a running program');
    case 'ps':
    case 'top':
    case 'htop':
    case 'tasklist':
      return T('liste les programmes en cours', 'lists running programs');
    case 'lsof':
    case 'netstat':
    case 'ss':
      return T('liste les ports et fichiers ouverts', 'lists open ports and files');
    case 'sleep':
      return T(`attend ${a[0] || ''} s`.trim(), `waits ${a[0] || ''}s`.trim());
    case 'date':
      return T("affiche la date et l'heure", 'prints the date');
    case 'whoami':
    case 'id':
      return T("affiche l'utilisateur courant", 'prints the current user');
    case 'uname':
    case 'sw_vers':
    case 'ver':
      return T('affiche la version du système', 'prints the OS version');
    case 'du':
    case 'df':
      return T("mesure l'espace disque", 'measures disk usage');
    case 'make':
    case 'just':
    case 'task':
      return T(`lance la tâche ${q(a[0] || 'par défaut')}`, `runs the ${qe(a[0] || 'default')} task`);
    case 'node':
    case 'deno':
    case 'tsx':
    case 'ts-node':
      if (has(rest, '-v', '--version')) return T('affiche la version de Node', 'prints the Node version');
      if (has(rest, '-e', '--eval', '-p')) return T('exécute un bout de code JavaScript', 'runs a JavaScript snippet');
      return a[0] ? T(`exécute le script ${q(a[0])}`, `runs the script ${qe(a[0])}`) : T('lance Node.js', 'starts Node.js');
    case 'bun':
      if (a[0] === 'run' || a[0] === 'test' || a[0] === 'install' || a[0] === 'add' || a[0] === 'x') return pkgManager('bun', rest);
      return a[0] ? T(`exécute ${q(a[0])} avec Bun`, `runs ${qe(a[0])} with Bun`) : T('lance Bun', 'starts Bun');
    case 'python':
    case 'python3':
    case 'py':
    case 'pypy': {
      const mi = rest.indexOf('-m');
      if (mi >= 0) {
        const mod = rest[mi + 1];
        if (mod === 'pytest' || mod === 'unittest') return T('lance les tests Python', 'runs the Python tests');
        if (mod === 'pip') return pip(rest.slice(mi + 2));
        if (mod === 'http.server') return T('démarre un petit serveur web local', 'starts a small local web server');
        if (mod === 'venv') return T('crée un environnement Python isolé', 'creates a Python virtual environment');
        return T(`exécute le module Python ${q(mod || '?')}`, `runs the Python module ${qe(mod || '?')}`);
      }
      if (has(rest, '-c')) return T('exécute un bout de code Python', 'runs a Python snippet');
      if (a[0] === '-' || !a[0]) return T('exécute un script Python', 'runs a Python script');
      if (has(rest, '--version', '-V')) return T('affiche la version de Python', 'prints the Python version');
      return T(`exécute le script ${q(a[0])}`, `runs the script ${qe(a[0])}`);
    }
    case 'pip':
    case 'pip3':
      return pip(rest);
    case 'uv':
      if (rest[0] === 'run') return T(`exécute ${q(rest[1] || '?')} via uv`, `runs ${qe(rest[1] || '?')} via uv`);
      if (rest[0] === 'add') return T(`ajoute ${listFr(a.slice(1))} au projet`, `adds ${listEn(a.slice(1))} to the project`);
      if (rest[0] === 'pip') return pip(rest.slice(1));
      if (rest[0] === 'sync') return T('installe les dépendances du projet', 'installs the project dependencies');
      return T(`utilise uv (${rest[0] || ''})`, `uses uv (${rest[0] || ''})`);
    case 'pytest':
      return T('lance les tests Python', 'runs the Python tests');
    case 'jest':
    case 'vitest':
    case 'mocha':
    case 'ava':
    case 'playwright':
    case 'cypress':
      return T('lance les tests', 'runs the tests');
    case 'tsc':
      return T('vérifie et compile le TypeScript', 'type-checks and compiles TypeScript');
    case 'eslint':
    case 'ruff':
    case 'flake8':
    case 'pylint':
    case 'biome':
      return T('analyse la qualité du code', 'lints the code');
    case 'prettier':
    case 'black':
    case 'gofmt':
    case 'rustfmt':
      return T('reformate le code', 'formats the code');
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return pkgManager(prog, rest);
    case 'npx':
    case 'pnpx':
    case 'bunx': {
      const tool = a.find((x) => x !== '-y' && x !== '--yes');
      return T(`exécute l’outil ${q(tool || '?')} (téléchargé si besoin)`, `runs the tool ${qe(tool || '?')} (downloaded if needed)`);
    }
    case 'git':
      return git(rest);
    case 'gh':
      return gh(rest);
    case 'docker':
    case 'podman':
      return docker(rest);
    case 'kubectl': {
      const sub = rest[0];
      if (sub === 'delete') return T('supprime des ressources Kubernetes', 'deletes Kubernetes resources');
      if (sub === 'apply') return T('applique une configuration Kubernetes', 'applies a Kubernetes config');
      return T(`interroge Kubernetes (${sub || ''})`, `queries Kubernetes (${sub || ''})`);
    }
    case 'terraform':
    case 'tofu': {
      const sub = rest[0];
      if (sub === 'destroy') return T("détruit l'infrastructure cloud", 'destroys the cloud infrastructure');
      if (sub === 'apply') return T("modifie l'infrastructure cloud", 'changes the cloud infrastructure');
      if (sub === 'plan') return T('prévisualise des changements d’infrastructure', 'previews infrastructure changes');
      return T(`utilise Terraform (${sub || ''})`, `uses Terraform (${sub || ''})`);
    }
    case 'vercel':
    case 'netlify':
    case 'firebase':
    case 'fly':
    case 'flyctl':
    case 'heroku':
    case 'wrangler':
    case 'railway': {
      const prod = has(rest, '--prod', '--production') || rest.includes('deploy') || rest.includes('publish');
      return prod ? T(`déploie en ligne avec ${prog}`, `deploys live with ${prog}`) : T(`utilise ${prog}`, `uses ${prog}`);
    }
    case 'aws':
    case 'gcloud':
    case 'az':
      return T(`agit sur ton compte cloud (${prog} ${rest[0] || ''})`, `acts on your cloud account (${prog} ${rest[0] || ''})`);
    case 'psql':
    case 'mysql':
    case 'sqlite3':
    case 'mongosh':
    case 'mongo':
    case 'redis-cli':
      return T(`interroge la base de données (${prog})`, `queries the database (${prog})`);
    case 'brew':
    case 'apt':
    case 'apt-get':
    case 'yum':
    case 'dnf':
    case 'pacman':
    case 'choco':
    case 'winget':
    case 'scoop':
    case 'port':
      if (['install', '-S', 'add'].includes(rest[0])) return T(`installe ${listFr(a.slice(1))} sur ta machine`, `installs ${listEn(a.slice(1))} on your machine`);
      if (['uninstall', 'remove', 'purge', '-R'].includes(rest[0])) return T(`désinstalle ${listFr(a.slice(1))}`, `uninstalls ${listEn(a.slice(1))}`);
      return T(`utilise le gestionnaire de logiciels ${prog}`, `uses the ${prog} package manager`);
    case 'cargo':
      return ({ build: T('compile le projet Rust', 'builds the Rust project'), test: T('lance les tests Rust', 'runs the Rust tests'), run: T('lance le programme Rust', 'runs the Rust program'), add: T(`ajoute ${listFr(a.slice(1))} au projet`, `adds ${listEn(a.slice(1))}`), publish: T('publie le paquet sur crates.io', 'publishes to crates.io') })[rest[0]] || T(`utilise cargo (${rest[0] || ''})`, `uses cargo (${rest[0] || ''})`);
    case 'go':
      return ({ build: T('compile le projet Go', 'builds the Go project'), test: T('lance les tests Go', 'runs the Go tests'), run: T('lance le programme Go', 'runs the Go program'), get: T('ajoute une dépendance Go', 'adds a Go dependency'), mod: T('gère les dépendances Go', 'manages Go modules') })[rest[0]] || T(`utilise go (${rest[0] || ''})`, `uses go (${rest[0] || ''})`);
    case 'mvn':
    case 'gradle':
    case 'gradlew':
    case 'dotnet':
      return T(`compile ou teste le projet (${prog} ${rest[0] || ''})`, `builds or tests the project (${prog} ${rest[0] || ''})`);
    case 'bash':
    case 'sh':
    case 'zsh':
    case 'pwsh':
    case 'powershell':
    case 'cmd':
      if (has(rest, '-c', '/c', '-Command')) return T('exécute une commande dans un autre shell', 'runs a command in another shell');
      return a[0] ? T(`exécute le script ${q(a[0])}`, `runs the script ${qe(a[0])}`) : T('exécute un script shell', 'runs a shell script');
    case 'claude':
      return T('lance une autre session Claude Code', 'starts another Claude Code session');
    case 'true':
    case 'false':
    case ':':
      return T('ne fait rien', 'does nothing');
    default:
      if (progPath.startsWith('./') || progPath.startsWith('/')) return T(`exécute le programme ${q(progPath)}`, `runs the program ${qe(progPath)}`);
      return T(`lance ${q(prog)}`, `runs ${qe(prog)}`);
  }
}

function pip(rest) {
  const sub = rest[0];
  const a = args(rest.slice(1));
  if (sub === 'install') {
    if (has(rest, '-r')) return T('installe les dépendances Python du projet', 'installs the Python dependencies');
    return T(`installe le paquet Python ${listFr(a)}`, `installs the Python package ${listEn(a)}`);
  }
  if (sub === 'uninstall') return T(`désinstalle ${listFr(a)}`, `uninstalls ${listEn(a)}`);
  if (sub === 'list' || sub === 'freeze') return T('liste les paquets Python installés', 'lists installed Python packages');
  return T(`utilise pip (${sub || ''})`, `uses pip (${sub || ''})`);
}

const JOIN = {
  '&&': T(', puis ', ', then '),
  ';': T(', puis ', ', then '),
  '||': T(', sinon ', ', otherwise '),
  '|': T(' → ', ' → '),
  '&': T(' (en arrière-plan), et ', ' (in the background), and '),
};

/**
 * Explain a whole command line in both languages.
 * Returns { fr, en, steps: [{ cmd, fr, en, prog }], heredoc }.
 */
function explainCommand(cmd) {
  const { segments, heredoc } = splitSegments(cmd);
  const steps = [];
  for (const s of segments) {
    const toks = tokenize(s.text);
    const e = explainTokens(toks);
    if (e) steps.push({ cmd: s.text, sep: s.sep, ...e });
  }
  if (!steps.length) return { fr: 'exécute une commande', en: 'runs a command', steps, heredoc };
  const MAX = 4;
  const shown = steps.slice(0, MAX);
  const build = (lang) => {
    let out = '';
    shown.forEach((st, i) => {
      out += st[lang];
      if (i < shown.length - 1) out += (JOIN[st.sep] || JOIN[';'])[lang];
    });
    if (steps.length > MAX) out += lang === 'fr' ? ` (+${steps.length - MAX} étapes)` : ` (+${steps.length - MAX} steps)`;
    if (heredoc) out += lang === 'fr' ? ' (avec un script intégré)' : ' (with an inline script)';
    return out;
  };
  return { fr: build('fr'), en: build('en'), steps, heredoc };
}

module.exports = { explainCommand, splitSegments, tokenize };
