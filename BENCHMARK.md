# Vigie face aux outils existants

Audit réalisé le 26 octobre 2026 avec Claude Code 2.1.310.

## Méthode, et ses limites

- **Schéma réel des hooks.** Une vraie session Claude Code (lecture, commande, recherche, écriture, modification, échec, sous-agent) a été enregistrée avec un plugin témoin. Les 31 payloads capturés servent de référence et de jeu de test (`test/fixtures/real-session.jsonl`, chemins anonymisés).
- **Concurrents.** Cinq dépôts ont été clonés et audités **statiquement** : lecture du code, des manifestes et des scripts de hooks. Leur exécution a été bloquée par la politique de sécurité de l'environnement de test, qui interdit de lancer du code tiers non audité. Les affirmations ci-dessous viennent donc du code source, pas d'une exécution, sauf mention contraire.
- **Un test en conditions réelles.** Le format de hook écrit par `claude-watch init` a été soumis au vrai Claude Code 2.1.310. Résultat : Claude Code l'ignore (« matcher ignored ») et aucun événement n'est capturé. Le format documenté, testé dans les mêmes conditions, fonctionne.

## Tableau

| | agents-observe | disler multi-agent | Claude-Code-Agent-Monitor | claude-devtools | claude-watch | **Vigie** |
|---|---|---|---|---|---|---|
| Installation | plugin, mais Docker requis par défaut | copier `.claude/` dans chaque projet ; uv, bun, just | `npm run setup`, Node ≥ 22.22 | app Electron | npm + build, `init` par projet | `/plugin install`, rien d'autre |
| Dépendances | Docker, Node, bash ; client React (21 dépendances) | Python via uv, Bun, Vue | 12 + 11 dépendances npm | 22 + 40 dépendances | 9 + 6 dépendances | **aucune** (Node ≥ 18 seul) |
| Taille du code | ~46 k lignes | ~13 k | ~193 k | ~80 k | ~5 k | ~3,3 k (+ 0,5 k de tests) |
| Windows sans Git Bash | non (hooks `bash …`) | non (`uv run`, chemins `$CLAUDE_PROJECT_DIR`) | partiel (certains hooks en `jq \| curl`) | oui (lit les journaux) | non (`curl "$(cat)"`) | **oui** (hooks en forme exec, sans shell) |
| Hooks valides sur 2.1.310 | oui | oui | oui ; le hook `cost-guard` lit `stop_reason`, champ absent du payload `Stop` réel | n/a (pas de hooks) | **non** : format ignoré, vérifié en direct | oui, vérifié en direct |
| Narration en langage clair | non (événements bruts) | résumé par IA, optionnel | non | non (vue technique détaillée) | non | **oui, déterministe, FR + EN** |
| Explication des commandes shell | non | non | non | non | non | **oui, étape par étape** |
| Détection de risque | non | blocage de `rm -rf` et `.env` | non | alertes regex configurables, après coup | non | **43 règles expliquées, 5 niveaux** |
| Garde-fou avant exécution | non | blocage brut (exit 2), sans explication à l'utilisateur | non | impossible (lecture des journaux) | non | **demande de confirmation avec la raison en clair** |
| Secrets dans le stockage | pas de masquage trouvé (seules les images base64 sont tronquées) | pas de masquage trouvé | masquage limité à sa config webhooks | n/a (lit les journaux existants) | pas de masquage trouvé | **masqués avant écriture** (clés API, tokens, mots de passe, clés privées) |
| Appels réseau externes | non | **oui** : `--summarize` appelle un LLM à chaque événement (clé API, coût, latence) | non par défaut | non | non | **aucun** |
| Exposition réseau du serveur | loopback par défaut | Bun.serve, toutes interfaces par défaut (non vérifié en exécution) | vérifie l'en-tête Host | mode standalone : `0.0.0.0` par défaut | `listen(port)` sans hôte : toutes interfaces | **127.0.0.1 + contrôle de l'en-tête Host** (anti DNS rebinding) |
| Vue terminal | non | non | non | non | non | **oui** |
| Public visé | développeurs, multi-agents | développeurs | équipes | développeurs | développeurs | **tout le monde, y compris les non-développeurs** |

## Ce que les concurrents font mieux

Il ne faut pas se raconter d'histoires.

- **claude-devtools** reconstruit le contexte du modèle et sa compression, plus finement que Vigie. Il fonctionne aussi sur les sessions passées sans hook.
- **agents-observe** et **Claude-Code-Agent-Monitor** gèrent l'historique multi-machines, le replay et les statistiques d'équipe. Vigie reste volontairement local et mono-utilisateur.
- **Claude-Code-Agent-Monitor** est traduit en cinq langues (pas en français) et propose une extension VS Code.

## Ce que Vigie fait que personne ne fait

1. **Il traduit en langage clair, pas seulement en logs.** Exemple : `git add -A && git commit -m "fix" && git push --force origin main` devient « prépare tous les fichiers pour la prochaine version, puis enregistre une version « fix », puis envoie de force sur le dépôt distant en écrasant son historique ». C'est déterministe, gratuit et hors ligne.
2. **Le garde-fou explique avant d'agir.** La boîte de confirmation de Claude Code affiche la raison : « Vigie — risque critique : Télécharge un script sur Internet et l'exécute immédiatement, sans que personne ne l'ait relu. »
3. **Rien ne sort de la machine, et les secrets ne sont jamais écrits sur disque.**
4. **Il marche partout.** Les hooks sont en forme exec (`node` + arguments, sans shell), et aucune dépendance n'est requise.

## Mesures

- Latence d'un hook : médiane 53 ms, maximum 79 ms, démarrage de Node compris, sur 45 événements réels rejoués (`test/hook.e2e.test.js`).
- 104 tests, tous verts : explications, règles de risque, masquage, garde-fou, serveur, vue terminal, robustesse face à une entrée invalide ou à un disque non inscriptible.
- `claude plugin validate . --strict` : aucune erreur, aucun avertissement.
