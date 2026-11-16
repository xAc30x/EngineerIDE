# EngineerIDE

Cross-platform (Linux and Windows) desktop AI workspace and IDE built with
Electron, Vite, React, TypeScript, and Tailwind CSS.

## Foundational Architectural Guardrails

1. **Strict Process Isolation:** Never import `electron`, `fs`, `path`, or `child_process` inside `src/`. All OS/file system operations must pass through a strictly typed `window.electronAPI` bridge in `electron/preload.ts` with `contextIsolation: true` and `nodeIntegration: false`.
2. **Cross-Platform Path Safety:** Always use Node's `path.join()` and `path.resolve()` in `electron/`. Never hardcode `/` or `\` separators or OS-specific paths.
3. **Provider-Agnostic AI Contract:** Define a clean `AIProviderAdapter` interface in `src/types/index.ts` supporting `'claude-cli' | 'openrouter' | 'anthropic-api' | 'openai-api'` so multiple subscription and API backends can be plugged in later without rewriting UI components.
4. **Milestone Dependency Discipline:** Keep Milestone 1 pure TypeScript/React/Electron (do NOT install native C++ modules like `better-sqlite3` or `node-pty` yet) so `npm install` runs cleanly without node-gyp build errors.
5. **Verification Gate:** Before concluding, run `npx tsc --noEmit` and verify there are zero TypeScript or Vite bundling errors.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server and opens the Electron app with hot reload. |
| `npx tsc --noEmit` | Type-checks `src/`, `electron/`, `tests/`, and the config files. |
| `npm test` | Runs the Vitest suite in `tests/`. |
| `npm run build` | Type-checks, then bundles the renderer to `dist/` and Electron code to `dist-electron/`. |
| `npm start` | Runs the built app (run `npm run build` first). |

## Layout

- `electron/` – main process. The only place that may use Node or Electron APIs.
  - `main.ts` – window creation and IPC handlers (`fs:selectFolder`, `fs:readDir`).
  - `preload.ts` – exposes the typed `window.electronAPI` bridge.
  - `channels.ts` – IPC channel names shared by `main.ts` and `preload.ts`.
  - `projectFiles.ts` – folder access rules (no Electron imports, so it is unit-testable).
- `src/` – renderer (React). Browser APIs only.
  - `types/index.ts` – shared contracts, including `ElectronAPI` and `AIProviderAdapter`.
  - `store/useAppStore.ts` – single Zustand store (in memory only).
  - `components/` – `shell/`, `sidebar/`, `workspace/`, `ide/`, `shared/`.
- `tests/` – Vitest tests. Kept outside `src/` because they use Node APIs.

## Conventions

- `electron/` may import **types** from `src/types`; `src/` never imports from `electron/`.
  `tests/processIsolation.test.ts` fails if a file in `src/` imports Electron or a Node built-in.
- IPC handlers return `IpcResult<T>` (`{ ok: true, value } | { ok: false, error }`) instead of throwing.
- `fs:readDir` only reads inside folders the user picked through the native dialog
  (`ProjectFileAccess` in `electron/projectFiles.ts`). Keep that check when adding file handlers.
- `window.electronAPI` is typed as optional; renderer code must handle it being absent.
- Workspace and IDE views stay mounted and are shown/hidden, so switching modes keeps their state.
- Secrets (API keys, tokens) never go in the repo or the renderer. The production
  Content-Security-Policy blocks network requests from the renderer; AI backends must
  be reached through the main process.
- Do not weaken or delete a test to make it pass.
