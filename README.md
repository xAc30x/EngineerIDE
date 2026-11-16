# EngineerIDE

Cross-platform (Linux and Windows) desktop AI workspace and IDE built with
Electron, Vite, React, TypeScript, and Tailwind CSS.

## Status: two-window shell (Milestone 1, roadmap Phases 0 and 2a)

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

Behind the scenes the main process can now stream long text output to both
windows (roadmap Phase 2a). A window that is reloaded or reopened mid-stream
catches up on the text so far, and either window can cancel a stream. Nothing
in the interface uses it yet; the chat will in Phase 2b.

Not included yet: AI backends (messages are stored but not answered), a code
editor, a terminal, and saving data between runs. The order they will be built
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
