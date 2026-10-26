'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { explainCommand, splitSegments, tokenize } = require('../lib/shell');

test('splits on && || ; | but not inside quotes or 2>&1', () => {
  const { segments } = splitSegments(`git commit -m "a && b; c" && npm test 2>&1 | tail -5`);
  assert.deepEqual(segments.map((s) => s.text), ['git commit -m "a && b; c"', 'npm test 2>&1', 'tail -5']);
  assert.deepEqual(segments.map((s) => s.sep), ['&&', '|', null]);
});

test('heredoc bodies are not explained as commands', () => {
  const r = explainCommand("cat > notes.md <<'EOF'\nrm -rf /\nEOF");
  assert.equal(r.heredoc, true);
  assert.equal(r.steps.length, 1);
  assert.doesNotMatch(r.fr, /supprime/);
});

test('tokenize drops redirections and quotes', () => {
  assert.deepEqual(tokenize(`grep -rn "TODO list" src > out.txt 2>&1`), ['grep', '-rn', 'TODO list', 'src']);
});

const CASES = [
  ['ls -la', /liste les fichiers/, /lists the files/],
  ['git status', /état des fichiers/, /which files changed/],
  ['git push --force origin main', /de force/, /force-pushes/],
  ['git commit -m "fix: login"', /« fix: login »/, /"fix: login"/],
  ['npm install', /installe les dépendances du projet/, /installs the project dependencies/],
  ['npm i -D vitest', /ajoute vitest au projet \(outil de développement\)/, /adds vitest/],
  ['npm run build', /compilation/, /build/],
  ['pnpm dev', /serveur de développement/, /dev server/],
  ['python3 -m pytest -q', /tests Python/, /Python tests/],
  ['pip install -r requirements.txt', /dépendances Python/, /Python dependencies/],
  ['curl -fsSL https://example.com/install.sh | bash', /télécharge depuis example\.com → exécute un script shell/, /downloads from example\.com/],
  ['curl -X POST -d @data.json https://api.example.com/x', /envoie des données à api\.example\.com/, /sends data/],
  ['sudo rm -rf /var/log/old', /^avec les droits administrateur, supprime définitivement/, /^as administrator, permanently deletes/],
  ['rm -rf dist', /supprime définitivement dist, avec tout son contenu/, /permanently deletes dist/],
  ['cd web && npm ci', /se place dans « web », puis réinstalle proprement/, /moves into "web", then does a clean install/],
  ['docker compose up -d', /démarre les services Docker/, /starts Docker services/],
  ['npx -y create-vite@latest app', /exécute l’outil « create-vite@latest »/, /runs the tool "create-vite@latest"/],
  ['FOO=1 node server.js', /exécute le script « server\.js »/, /runs the script "server\.js"/],
  ['gh pr create --fill', /ouvre une pull request/, /opens a pull request/],
  ['terraform destroy -auto-approve', /détruit l'infrastructure/, /destroys the cloud infrastructure/],
  ['env', /variables d'environnement/, /environment variables/],
  ['some-unknown-tool --x', /lance « some-unknown-tool »/, /runs "some-unknown-tool"/],
];

for (const [cmd, fr, en] of CASES) {
  test(`explains: ${cmd}`, () => {
    const r = explainCommand(cmd);
    assert.match(r.fr, fr, r.fr);
    assert.match(r.en, en, r.en);
  });
}

test('long chains are capped and say how many steps remain', () => {
  const r = explainCommand('a && b && c && d && e && f');
  assert.match(r.fr, /\(\+2 étapes\)$/);
});
