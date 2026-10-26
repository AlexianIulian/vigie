---
name: recap
description: Summarise in plain language what Claude Code did in the current project session — files read and changed, commands run, risky actions and what Vigie flagged. Use when the user asks what Claude did, for a recap, a summary of changes, or whether anything risky happened.
allowed-tools: Bash(node:*)
---

# Recap of the session

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vigie.js" recap --cwd "$PWD"
```

Rewrite its output for the user in their language, briefly and without jargon:

1. What was done (counts and the files changed).
2. Anything risky, with the reason Vigie gave. If nothing was risky, say so in one line.
3. The dashboard address if the output includes one.

Do not invent actions that are not in the output. If it says no session was recorded, explain that Vigie records from the moment the plugin is enabled.
