'use strict';
// Risk assessment. Each tool call gets a level — none, low, medium, high, critical —
// with plain-language reasons. Deliberately conservative and explainable: every
// verdict comes with the rule that produced it, so a person can disagree with it.

const { isInside, fwd, basename } = require('./util');
const { splitSegments, tokenize } = require('./shell');

const LEVELS = ['none', 'low', 'medium', 'high', 'critical'];
const rank = (l) => LEVELS.indexOf(l);
const T = (fr, en) => ({ fr, en });

const SECRET_FILE = /(^|\/)(\.env(\.[\w-]+)?|\.envrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.netrc|\.npmrc|\.pypirc|\.pgpass|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|service-account[\w-]*\.json|[\w-]+\.(pem|key|p12|pfx|keystore|jks))$/i;
const SECRET_DIR = /(^|\/)(\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.config\/gcloud|\.azure)(\/|$)/i;
const SAFE_ENV = /\.env\.(example|sample|template|dist|defaults?)$/i;
const SYSTEM_PATH = /^(\/etc|\/usr|\/bin|\/sbin|\/System|\/Library|\/var|\/boot|[a-z]:\/windows|[a-z]:\/program files)(\/|$)/i;
const SHELL_RC = /(^|\/)\.(bashrc|bash_profile|zshrc|zprofile|profile|config\/fish\/config\.fish)$|(^|\/)Microsoft\.PowerShell_profile\.ps1$/i;
const CI_FILE = /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/|Jenkinsfile$|azure-pipelines\.yml$)/i;
const DEP_FILE = /(^|\/)(package\.json|requirements[\w-]*\.txt|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|composer\.json)$/i;

function isSecretPath(p) {
  const f = fwd(p);
  if (!f || SAFE_ENV.test(f)) return false;
  return SECRET_FILE.test(f) || SECRET_DIR.test(f);
}

class Verdict {
  constructor() {
    this.level = 'none';
    this.reasons = [];
  }
  add(level, code, fr, en) {
    if (rank(level) > rank(this.level)) this.level = level;
    if (!this.reasons.some((r) => r.code === code)) this.reasons.push({ level, code, fr, en });
    return this;
  }
  toJSON() {
    const reasons = this.reasons.sort((a, b) => rank(b.level) - rank(a.level));
    return { level: this.level, reasons };
  }
}

// ---------- shell commands ----------

const NET = /\b(curl|wget|nc|ncat|netcat|scp|rsync|ftp|sftp|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b/;

function assessBash(command, cwd, v) {
  const raw = String(command || '');
  const low = raw.toLowerCase();
  const { segments } = splitSegments(raw);

  // Remote code execution: download piped into an interpreter.
  if (/\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|python3?|node|perl|ruby|iex|invoke-expression|pwsh|powershell)\b/i.test(raw) ||
      /\b(iex|invoke-expression)\b.*\b(iwr|irm|downloadstring|invoke-webrequest|invoke-restmethod)\b/i.test(raw) ||
      /(bash|sh|zsh)\s+<\(\s*(curl|wget)/i.test(raw)) {
    v.add('critical', 'remote-exec', "Télécharge un script sur Internet et l'exécute immédiatement, sans que personne ne l'ait relu.", 'Downloads a script from the internet and runs it immediately, unreviewed.');
  }

  for (const seg of segments) {
    const toks = tokenize(seg.text);
    let i = 0;
    while (toks[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
    let sudo = false;
    while (toks[i] && ['sudo', 'doas', 'time', 'nohup', 'env', 'nice', 'command', 'exec'].includes(toks[i])) {
      if (toks[i] === 'env' && toks.slice(i + 1).every((t) => t.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t))) break;
      if (toks[i] === 'sudo' || toks[i] === 'doas') sudo = true;
      i++;
      while (toks[i] && toks[i].startsWith('-')) i++;
    }
    const prog = basename(toks[i] || '').replace(/\.exe$/i, '');
    const rest = toks.slice(i + 1);
    const flags = rest.filter((t) => t.startsWith('-')).join(' ');
    const targets = rest.filter((t) => !t.startsWith('-'));

    if (sudo) v.add('high', 'sudo', "Utilise les droits administrateur : la commande peut modifier tout l'ordinateur.", 'Runs with administrator rights: it can change the whole machine.');

    if (['rm', 'del', 'rd', 'rmdir', 'Remove-Item', 'unlink'].includes(prog)) {
      const recursive = /(^|\s)-[a-zA-Z]*[rR]|--recursive|\/s\b|-Recurse/.test(flags);
      const dangerous = targets.filter((t) => isDangerousTarget(t, cwd));
      if (dangerous.length) {
        v.add('critical', 'rm-dangerous', `Supprime définitivement ${dangerous.join(', ')} : c'est hors du projet ou bien trop large. Rien ne passe par la corbeille.`, `Permanently deletes ${dangerous.join(', ')}: outside the project or far too broad. Nothing goes to the trash.`);
      } else if (recursive) {
        v.add('medium', 'rm-recursive', 'Supprime définitivement des dossiers entiers dans le projet (pas de corbeille).', 'Permanently deletes whole folders inside the project (no trash).');
      } else if (targets.length) {
        v.add('low', 'rm', 'Supprime des fichiers du projet.', 'Deletes project files.');
      }
    }

    if (prog === 'find' && /-delete|-exec\s+rm/.test(rest.join(' '))) {
      v.add('high', 'find-delete', 'Cherche des fichiers et les supprime en masse.', 'Finds files and deletes them in bulk.');
    }

    if (prog === 'git') {
      const sub = targets[0];
      const joined = rest.join(' ');
      if (sub === 'push') {
        if (/--force(?!-with-lease)|(^|\s)-[a-zA-Z]*f\b|\s\+\S+/.test(' ' + joined)) {
          const main = /\b(main|master|prod|production|release)\b/.test(joined);
          v.add(main ? 'critical' : 'high', 'git-force-push', `Écrase l'historique du dépôt distant${main ? ' sur la branche principale' : ''} : le travail des autres peut être perdu.`, `Overwrites the remote history${main ? ' on the main branch' : ''}: other people's work can be lost.`);
        } else if (/--force-with-lease/.test(joined)) {
          v.add('medium', 'git-force-lease', "Réécrit l'historique distant (avec une sécurité).", 'Rewrites remote history (with a safety check).');
        } else {
          v.add('medium', 'git-push', 'Publie des changements sur le dépôt distant, visibles par les autres.', 'Publishes changes to the remote, visible to others.');
        }
      }
      if (sub === 'reset' && /--hard/.test(joined)) v.add('high', 'git-reset-hard', 'Efface toutes les modifications non enregistrées, sans retour possible.', 'Erases all uncommitted changes, irreversibly.');
      if (sub === 'clean' && /-[a-zA-Z]*f/.test(joined)) v.add('high', 'git-clean', 'Supprime tous les fichiers que git ne suit pas (ils ne sont pas récupérables).', 'Deletes every untracked file (not recoverable).');
      if (sub === 'checkout' && rest.includes('--')) v.add('medium', 'git-discard', 'Annule des modifications non enregistrées.', 'Discards uncommitted changes.');
      if (sub === 'restore' && !/--staged/.test(joined)) v.add('medium', 'git-discard', 'Annule des modifications non enregistrées.', 'Discards uncommitted changes.');
      if (sub === 'branch' && /(^|\s)-D\b/.test(joined)) v.add('medium', 'git-branch-delete', 'Supprime une branche, même si elle contient du travail non fusionné.', 'Deletes a branch even if it has unmerged work.');
      if (sub === 'rebase' || (sub === 'commit' && /--amend/.test(joined))) v.add('low', 'git-rewrite', "Réécrit l'historique local.", 'Rewrites local history.');
      if (sub === 'filter-branch' || sub === 'filter-repo') v.add('high', 'git-filter', "Réécrit tout l'historique du dépôt.", 'Rewrites the whole repository history.');
    }

    if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog)) {
      const sub = targets[0];
      if (sub === 'publish') v.add('high', 'publish', 'Publie le paquet sur le registre public : visible par tout le monde, difficile à retirer.', 'Publishes the package publicly: visible to everyone, hard to undo.');
      if (['install', 'i', 'add'].includes(sub) && targets.length > 1) {
        const global = /(^|\s)(-g|--global)\b/.test(flags);
        v.add(global ? 'medium' : 'low', 'dep-add', `Ajoute du code tiers (${targets.slice(1).join(', ')})${global ? ' à toute la machine' : ''} : il s'exécutera sur ta machine.`, `Adds third-party code (${targets.slice(1).join(', ')})${global ? ' machine-wide' : ''}: it will run on your machine.`);
      }
    }
    if (['npx', 'pnpx', 'bunx'].includes(prog) || (['pnpm', 'yarn'].includes(prog) && targets[0] === 'dlx')) {
      v.add('low', 'npx', 'Télécharge et exécute un outil tiers.', 'Downloads and runs a third-party tool.');
    }
    if ((prog === 'pip' || prog === 'pip3' || (prog === 'uv' && targets[0] === 'pip')) && rest.includes('install') && !rest.includes('-r')) {
      v.add('low', 'dep-add', 'Ajoute du code tiers qui s’exécutera sur ta machine.', 'Adds third-party code that will run on your machine.');
    }
    if (['cargo', 'twine', 'gem'].includes(prog) && /\b(publish|upload|push)\b/.test(rest.join(' '))) {
      v.add('high', 'publish', 'Publie sur un registre public.', 'Publishes to a public registry.');
    }
    if (['brew', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'choco', 'winget', 'scoop'].includes(prog) && /\b(install|remove|uninstall|purge)\b|-S\b|-R\b/.test(rest.join(' '))) {
      v.add('medium', 'system-install', 'Installe ou retire un logiciel sur ton ordinateur (hors du projet).', 'Installs or removes software on your computer (outside the project).');
    }

    if (prog === 'chmod' && /(^|\s)(-R\s+)?(777|a\+rwx|o\+w)/.test(rest.join(' '))) {
      v.add('high', 'chmod-open', "Rend des fichiers modifiables par n'importe qui.", 'Makes files writable by anyone.');
    }
    if (['dd', 'mkfs', 'diskutil', 'format', 'fdisk', 'parted', 'shred', 'wipefs'].includes(prog) || /^mkfs\./.test(prog)) {
      v.add('critical', 'disk', 'Peut effacer ou reformater un disque entier.', 'Can wipe or reformat an entire disk.');
    }
    if (['shutdown', 'reboot', 'halt', 'poweroff'].includes(prog)) {
      v.add('high', 'power', "Éteint ou redémarre l'ordinateur.", 'Shuts down or restarts the computer.');
    }
    if (['kill', 'pkill', 'killall', 'taskkill'].includes(prog)) {
      v.add('low', 'kill', 'Arrête de force un programme en cours.', 'Force-stops a running program.');
    }

    if (prog === 'terraform' || prog === 'tofu') {
      if (targets[0] === 'destroy') v.add('critical', 'infra-destroy', "Détruit l'infrastructure cloud (serveurs, bases…).", 'Destroys the cloud infrastructure (servers, databases…).');
      else if (targets[0] === 'apply') v.add('high', 'infra-apply', "Modifie l'infrastructure cloud réelle.", 'Changes real cloud infrastructure.');
    }
    if (prog === 'kubectl' && targets[0] === 'delete') v.add('high', 'k8s-delete', 'Supprime des ressources du cluster.', 'Deletes cluster resources.');
    if (['vercel', 'netlify', 'firebase', 'fly', 'flyctl', 'heroku', 'wrangler', 'railway'].includes(prog) && /--prod|--production|\bdeploy\b|\bpublish\b/.test(rest.join(' '))) {
      v.add('high', 'deploy', 'Met en ligne une nouvelle version, visible par tes utilisateurs.', 'Ships a new version live to your users.');
    }
    if (['aws', 'gcloud', 'az'].includes(prog) && /\b(delete|remove|rm|destroy|terminate)\b/.test(rest.join(' '))) {
      v.add('high', 'cloud-delete', 'Supprime des ressources sur ton compte cloud.', 'Deletes resources in your cloud account.');
    }
    if (['ssh', 'scp', 'rsync'].includes(prog)) v.add('medium', 'remote', 'Agit sur une autre machine.', 'Acts on another machine.');
    if (['env', 'printenv'].includes(prog) && !targets.length) v.add('medium', 'env-dump', "Affiche toutes les variables d'environnement, qui contiennent souvent des clés secrètes.", 'Prints every environment variable, which often hold secret keys.');
    if (prog === 'sed' && /(^|\s)-i/.test(flags) && targets.some((t) => isOutside(t, cwd))) {
      v.add('medium', 'outside-write', 'Modifie des fichiers en dehors du projet.', 'Edits files outside the project.');
    }
    if (prog === 'crontab' || prog === 'launchctl' || prog === 'schtasks' || prog === 'systemctl') {
      v.add('medium', 'persistence', "Crée ou modifie une tâche qui s'exécutera automatiquement.", 'Creates or changes something that runs automatically.');
    }

    // Secrets touched by a shell command
    const secretTargets = targets.filter((t) => isSecretPath(t));
    if (secretTargets.length) {
      v.add('high', 'secret-read', `Accède à ${secretTargets.join(', ')}, qui contient probablement des clés secrètes. Son contenu sera envoyé au modèle.`, `Touches ${secretTargets.join(', ')}, which likely holds secret keys. Its content will be sent to the model.`);
    }
  }

  // Secret + network in the same command line: possible exfiltration.
  const anySecret = /(^|[\s'"=@<])(\S*\/)?(\.env(\.[\w-]+)?|id_rsa|id_ed25519|\.aws\/credentials|\.ssh\/|\.npmrc|\.netrc)\b/i.test(raw) && !SAFE_ENV.test(raw);
  if (anySecret && NET.test(raw)) {
    v.add('critical', 'exfiltration', "Envoie potentiellement des fichiers secrets vers Internet dans la même commande.", 'May send secret files to the internet in the same command.');
  }

  // SQL that destroys data
  if (/\b(drop\s+(table|database|schema)|truncate\s+table)\b/i.test(raw) || /\bdelete\s+from\s+\w+\s*(;|"|'|$)/i.test(raw)) {
    v.add('critical', 'sql-destroy', 'Supprime des données en base (table entière ou toutes les lignes).', 'Deletes database data (a whole table or every row).');
  }

  if (/>\s*\/dev\/(sd|disk|nvme)/.test(low)) v.add('critical', 'disk', 'Écrit directement sur un disque.', 'Writes directly to a disk.');
}

function isOutside(target, cwd) {
  const t = fwd(target);
  if (!cwd || !/^(\/|~|[a-z]:\/)/i.test(t)) return false; // relative paths stay inside the project
  if (t.startsWith('~')) return true;
  return !isInside(t, cwd);
}

function isDangerousTarget(t, cwd) {
  const s = fwd(t).replace(/\/+$/, '') || '/';
  if (['/', '~', '$HOME', '${HOME}', '*', '/*', '~/*', '.', './', '..', '../', './*', '%USERPROFILE%', 'C:', 'c:'].includes(s) || s === '') return true;
  if (/^(\.\.\/)+\.?\.?$|^\.\.(\/\*)?$/.test(s)) return true;
  if (cwd && fwd(cwd).replace(/\/+$/, '').toLowerCase() === s.toLowerCase()) return true; // the whole project
  if (/^(\/|~\/?)[^/]*$/.test(s) && s !== '/tmp' && !s.startsWith('/tmp/')) return true; // a top-level folder like /usr or ~/Documents root
  if (/^~\/(Documents|Desktop|Downloads|Pictures|Library|\.ssh|\.config)\/?$/i.test(s)) return true;
  if (SYSTEM_PATH.test(s)) return true;
  if (isOutside(s, cwd) && !s.startsWith('/tmp/')) return true;
  return false;
}

// ---------- file tools ----------

function assessFile(tool, file, cwd, v, input) {
  const f = fwd(file);
  if (!f) return;
  const writes = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool);
  if (isSecretPath(f)) {
    if (writes) v.add('medium', 'secret-write', 'Modifie un fichier de secrets (clés, mots de passe).', 'Edits a secrets file (keys, passwords).');
    else v.add('high', 'secret-read', 'Lit un fichier qui contient probablement des clés secrètes : son contenu sera envoyé au modèle.', 'Reads a file that likely holds secret keys: its content will be sent to the model.');
  }
  if (!writes) return;
  if (SYSTEM_PATH.test(f)) v.add('high', 'system-write', 'Modifie un fichier système de ton ordinateur.', 'Edits a system file on your computer.');
  else if (SHELL_RC.test(f)) v.add('high', 'shell-rc', "Modifie la configuration de ton terminal : ça s'appliquera à toutes tes futures sessions.", 'Edits your shell startup config: it applies to every future session.');
  else if (cwd && isOutside(f, cwd)) v.add('medium', 'outside-write', 'Modifie un fichier en dehors du projet.', 'Edits a file outside the project.');
  if (CI_FILE.test(f)) v.add('medium', 'ci', 'Modifie le pipeline CI/CD (ce qui tourne automatiquement à chaque push).', 'Edits the CI/CD pipeline (what runs on every push).');
  if (DEP_FILE.test(f) && tool !== 'Read') v.add('low', 'deps-file', 'Modifie la liste des dépendances du projet.', 'Edits the project dependency list.');
  if (tool === 'Write' && input && typeof input.content === 'string' && /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash)/.test(input.content)) {
    v.add('medium', 'script-remote', "Écrit un script qui télécharge et exécute du code depuis Internet.", 'Writes a script that downloads and runs code from the internet.');
  }
}

// ---------- MCP & others ----------

function assessMcp(tool, v) {
  const name = tool.toLowerCase();
  if (/(send|reply|forward|post_message|create_draft|publish|tweet|post$|share)/.test(name)) {
    v.add('high', 'mcp-send', 'Envoie ou publie quelque chose en ton nom via un service connecté.', 'Sends or publishes something on your behalf through a connected service.');
  } else if (/(delete|remove|trash|destroy|drop|archive|cancel)/.test(name)) {
    v.add('high', 'mcp-delete', 'Supprime des données dans un service connecté.', 'Deletes data in a connected service.');
  } else if (/(create|update|write|edit|move|upload|insert|set_|patch)/.test(name)) {
    v.add('medium', 'mcp-write', 'Modifie des données dans un service connecté.', 'Changes data in a connected service.');
  }
}

/**
 * Assess one PreToolUse / PostToolUse payload.
 * @returns {{level: string, reasons: Array<{level, code, fr, en}>}}
 */
function assess(payload) {
  const v = new Verdict();
  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};
  const cwd = payload.cwd || '';
  if (tool === 'Bash' || tool === 'PowerShell') assessBash(input.command, cwd, v);
  else if (['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) assessFile(tool, input.file_path || input.notebook_path, cwd, v, input);
  else if (tool === 'Grep' || tool === 'Glob') {
    if (input.path && isSecretPath(input.path)) v.add('medium', 'secret-search', 'Fouille un dossier de secrets.', 'Searches a secrets folder.');
  } else if (tool.startsWith('mcp__')) assessMcp(tool, v);
  if (payload.permission_mode === 'bypassPermissions' && rank(v.level) >= rank('high')) {
    v.add(v.level, 'bypass', 'Les autorisations sont désactivées dans cette session : personne ne validera cette action.', 'Permissions are disabled in this session: nobody will confirm this action.');
  }
  return v.toJSON();
}

module.exports = { assess, LEVELS, rank, isSecretPath };
