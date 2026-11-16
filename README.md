# EngineerIDE

Cross-platform (Linux and Windows) desktop AI workspace and IDE built with
Electron, Vite, React, TypeScript, and Tailwind CSS.

## Status: Milestone 1 – desktop shell and dual-mode UI

- **Workspace mode** – centered chat, a collapsible Artifacts/Design side panel,
  sidebar sections, and placeholder pages for Projects, Artifacts, Scheduled, and Design.
- **IDE mode** – file explorer, editor placeholder, and a docked agent chat that
  shows the same conversation as Workspace mode.
- Switch modes with the header button or `Ctrl+E` (`Cmd+E` on macOS).

Not included yet: AI backends (messages are stored but not answered), a code
editor, a terminal, and saving data between runs.

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

`npm run dev` starts the Vite dev server and opens the desktop window. Code
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
