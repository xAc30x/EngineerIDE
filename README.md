# EngineerIDE

Cross-platform (Linux and Windows) desktop AI workspace and IDE built with
Electron, Vite, React, TypeScript, and Tailwind CSS.

## Status: two-window shell with streamed replies (roadmap Phases 0, 2a, and 2b)

The app runs as two windows that stay open together, so they can sit side by
side or on separate monitors:

- **Workspace window** – centered chat, a collapsible Artifacts/Design side panel,
  sidebar sections, and placeholder pages for Projects, Artifacts, Scheduled, and Design.
- **IDE window** – file explorer, editor placeholder, and a docked agent chat.
- The header button (`IDE` in the Workspace window, `Agent Window` in the IDE
  window) or `Ctrl+E` (`Cmd+E` on macOS) opens the other window, or brings it to
  the front if it is already open. The current window stays open.
- Both windows show the same conversation, project folder, and AI backend. That
  state lives in the Electron main process and is sent to both windows on every
  change. The unsent chat draft and the panel toggles belong to each window.
- Closing a window closes only that window; the other one stays open, and its
  header button brings the closed one back as you left it. The app quits when
  you close the last window on screen.

- A message gets a reply that streams into both windows as it is written.
  Either window can stop it with **Stop**, and a window reloaded mid-reply
  shows the text so far, then continues. A chat replies to one message at a
  time; sending another while it is replying is refused with a message.

**Claude Sub (CLI)** replies with the Claude Code CLI installed on your
computer and signed in to your account (`claude auth login`). If the CLI is
missing or not signed in, the backend selector says so. Stop ends the reply,
and quitting the app ends any reply still running. Replies are chat only: the
CLI's tools are switched off.

The API-key backends arrive in Phase 2d. Until then, in a development build
(`npm run dev`) they answer with a built-in test reply that starts with
`[Test reply]`; a packaged build says the backend is not available yet.

Not included yet: the API-key backends, a code editor, a terminal, and saving data
between runs. The order they will be built
in is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

- Node.js 22 or newer (includes `npm`)

## Getting started

Run these in a terminal, inside the project folder:

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` starts the Vite dev server and opens the Workspace window. Code
changes reload automatically. Press `Ctrl+C` in the terminal to stop.

## Other commands

| Command | What it does |
| --- | --- |
| `npx tsc --noEmit` | Type-checks the whole project. |
| `npm test` | Runs the automated tests. |
| `npm run build` | Type-checks and builds the app into `dist/` and `dist-electron/`. |
| `npm start` | Runs the built app (after `npm run build`). |

## Project rules

The architectural rules and code conventions are in [CLAUDE.md](CLAUDE.md).
The build plan, with what each phase may change, is in [docs/ROADMAP.md](docs/ROADMAP.md).
