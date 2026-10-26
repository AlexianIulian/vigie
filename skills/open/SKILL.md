---
name: open
description: Open the Vigie dashboard that shows, in plain French or English, everything Claude Code is doing in this session. Use when the user asks to see what Claude is doing, to open Vigie, the dashboard, the live view or the terminal feed.
allowed-tools: Bash(node:*)
---

# Open the Vigie dashboard

Run this command. It starts the local dashboard if needed, prints its address and opens it in the browser:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vigie.js" open
```

Then tell the user, in their language and in two or three short sentences:

- the address it printed (for example `http://localhost:7456`), which only works on this computer;
- that they can also follow everything live inside a terminal, in a second pane next to this session, with:
  `node ~/.vigie/vigie.cjs tail --here`
  (on Windows: `node %USERPROFILE%\.vigie\vigie.cjs tail --here`).

If the command prints an error, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/vigie.js" doctor` and report what it says.
