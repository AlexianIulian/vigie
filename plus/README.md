<p align="center"><img src=".claude-plugin/icon.png" width="72" alt=""></p>

<h1 align="center">Vigie+</h1>

<p align="center"><b>Apprendre le terminal en regardant Claude travailler.</b><br>
Un panneau à côté du chat qui transforme chaque action de Claude Code en mini-leçon, avec XP, niveaux, badges, quêtes et quiz.</p>

Vigie te dit *ce que fait* Claude. Vigie+ t'apprend *comment ça marche*, pendant que tu travailles, sans rien interrompre.

## Ce que tu vois

**👁 Live.** Chaque commande est découpée en couleurs : programme, sous-commande, options, chemins, opérateurs, texte. Chaque option est traduite (plus de 140 au catalogue : `-l` format long, `-a` fichiers cachés…), avec une phrase d'explication et une astuce à retenir. Pour une modification de fichier, un diff montre ce qui change. Les actions sensibles (`rm -rf`, `sudo`, `push --force`, `reset --hard`…) s'affichent en rouge.

**🎓 Coach IA.** Une commande inconnue ? Le bouton « Décoder » demande à Haiku de l'expliquer morceau par morceau. Les réponses sont gardées en cache, et ce qui ressemble à une clé ou à un mot de passe est masqué avant l'envoi.

**📚 Codex.** 100 notions à collectionner, rangées par famille : shell, opérateurs, Git, langages et paquets, réseau, outils de Claude. Celles que tu n'as pas encore croisées restent verrouillées 🔒.

**🎯 Quêtes du jour.** Trois défis par jour (« repère un tuyau | », « atteins un combo x10 »…), qui avancent tout seuls. Une série de jours d'affilée 🔥 te récompense si tu reviens.

**🧠 Quiz.** Après chaque réponse de Claude, une question sur une notion que tu as vue : à quoi elle sert, quelle notion correspond à un usage, ou ce que fait une option. La répétition espacée (boîtes de Leitner) ramène plus souvent ce que tu oublies.

**📊 Stats.** Ton XP des 14 derniers jours en graphique, ta progression par famille, tes badges et les réglages.

Et autour du panneau : 7 rangs (de 🐣 Mousse à 👑 Amiral), 18 badges, des combos ⚡ qui multiplient l'XP tant que rien n'échoue, des sons 8-bit, un bandeau au-dessus du prompt et ton rang dans la barre d'état.

**👩‍🏫 Mode prof.** Avec `/vigie-plus prof`, Claude reçoit une consigne : t'envoyer lui-même, au plus une fois par tour, une leçon sur la notion qu'il est en train d'utiliser.

## Installation

Dans Claude Code :

```
/plugin install vigie-plus --marketplace AlexianIulian/vigie
```

Réponds `y` pour ajouter le marketplace, puis choisis la portée. Depuis un shell :

```
claude plugin install vigie-plus --marketplace AlexianIulian/vigie
```

Le panneau s'ouvre tout seul sur le côté quand le terminal est assez large (environ 144 colonnes). Sinon, tape `/vigie-plus`.

## Commandes

| Commande | Effet |
|---|---|
| `/vigie-plus` | ouvre le panneau |
| `/vigie-plus codex` · `quetes` · `quiz` · `stats` | ouvre directement un onglet |
| `/vigie-plus prof` | active ou coupe le mode prof |
| `/vigie-plus coach` | active ou coupe le coach automatique pour les commandes inconnues |
| `/vigie-plus son` · `bandeau` | active ou coupe les sons, le bandeau |

Dans le panneau : `l` `c` `q` `z` `s` changent d'onglet, `1` `2` `3` répondent au quiz, `n` passe à la question suivante, `d` lance le décodage.

## Vie privée et coût

Vigie+ observe et ne bloque jamais rien : s'il plante, l'action de Claude continue. Ta progression reste sur ta machine, dans le stockage du plugin.

Le seul appel réseau est le coach : il passe par la connexion Claude de ta session, avec le modèle Haiku, et seulement quand tu appuies sur « Décoder » ou que tu actives le coach automatique (25 décodages au plus par session, réponses gardées en cache). Le mode prof ajoute une courte consigne au prompt de Claude, uniquement si tu l'actives.

## Développement

```
claude plugin validate plus
claude plugin test plus
```

Licence MIT.
