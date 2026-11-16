# EngineerIDE

Cross-platform (Linux and Windows) desktop AI workspace and IDE built with
Electron, Vite, React, TypeScript, and Tailwind CSS.

The build plan is in [docs/ROADMAP.md](docs/ROADMAP.md). Work one phase at a
time and follow its rules ("How to work a phase").

## Foundational Architectural Guardrails

1. **Strict Process Isolation:** Never import `electron`, `fs`, `path`, or `child_process` inside `src/` or `shared/`. All OS/file system operations must pass through the strictly typed `window.electronAPI` bridge built in `electron/preload.ts`, with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
2. **Cross-Platform Path Safety:** Always use Node's `path.join()` and `path.resolve()` in `electron/`. Never hardcode `/` or `\` separators or OS-specific paths.
3. **Provider-Agnostic AI Contract:** `AIProviderAdapter` in `shared/types.ts` supports `'claude-cli' | 'openrouter' | 'anthropic-api' | 'openai-api'`, so backends can be plugged in without rewriting UI components. Providers run in the main process (roadmap Phase 2b).
4. **Dependency Discipline:** Add a native C++ module (for example `better-sqlite3` or `node-pty`) only in the roadmap phase that names it, and at most one per phase, so `npm install` keeps running without node-gyp build errors.
5. **Verification Gate:** Before concluding, meet the shared definition of done in the roadmap: `npx tsc --noEmit`, `npm test`, `npm run build`, and a check observed in the running app with both windows open. CI (`.github/workflows/ci.yml`) runs the first three on every pull request and on `main`; the two-window check is manual.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server and opens the Electron app with hot reload. |
| `npx tsc --noEmit` | Type-checks `src/`, `shared/`, `electron/`, `tests/`, and the config files. |
| `npm test` | Runs the Vitest suite in `tests/`. |
| `npm run build` | Type-checks, then bundles the renderer to `dist/` and Electron code to `dist-electron/`. |
| `npm start` | Runs the built app (run `npm run build` first). |

## Layout

- `shared/` – code both processes run. Pure TypeScript: no Node, Electron, React, or DOM imports.
  - `types.ts` – shared contracts (threads, files, `IpcResult`, `AIProviderAdapter`).
  - `appState.ts` – shared state shape, `applyAction()`, and `parseAction()`.
  - `backends.ts` – the AI backend list.
  - `ipc/<domain>.ts` – one file per IPC domain: channel names, payload types, and that domain's part of the bridge API.
  - `electronApi.ts` – `ElectronAPI`, the sum of every domain's bridge API.
- `electron/` – main process. The only place that may use Node or Electron APIs.
  - `main.ts` – start-up only: creates the registry and stores, registers each IPC domain.
  - `windows.ts` – window registry: focus-or-create, close and quit rules, trusted senders.
  - `appStateStore.ts` – owns the shared state and its version (no Electron imports, unit-testable).
  - `projectFiles.ts` – folder access rules (no Electron imports, unit-testable).
  - `streams/` – `streamHub.ts` owns every stream's chunks and status and batches them to subscribers (no Electron imports, unit-testable); `testStream.ts` is the development-only fake producer; `requests.ts` validates stream requests.
  - `ipc/<domain>.ts` – IPC handlers for one domain.
  - `preload/<domain>.ts` – bridge methods for one domain; `preload.ts` combines them.
- `src/` – renderer (React). Browser APIs only. Both windows load the same bundle.
  - `store/useAppStore.ts` – one Zustand store per window: a mirror of the shared state plus that window's own UI state.
  - `lib/windowKind.ts` – which window this is, and how to open the other one.
  - `hooks/useStream.ts` – follows one stream by id: the text so far, then live chunks, plus its status and `cancel()`.
  - `components/` – `shell/`, `sidebar/`, `workspace/`, `ide/`, `shared/`.
  - `types/index.ts` – re-exports the contracts from `shared/`.
- `tests/` – Vitest tests. Kept outside `src/` because they use Node APIs.
- `docs/ROADMAP.md` – phases, file ownership, and definitions of done.

## Window model

- There are two windows: **Workspace** (chat hub, projects, artifacts, scheduled tasks) and **IDE** (explorer, editor, agent chat). Both load `index.html`; the IDE window adds `?window=ide`.
- Only `electron/windows.ts` creates windows. The renderer asks through `electronAPI.showWindow(kind)`, which opens the window or focuses it if it exists. Switching never hides or closes the current window.
- Closing a window affects only that window. While the other window is on screen, the closed one is hidden rather than destroyed, so reopening keeps its state (expanded folders, unsent draft). Closing the last visible window quits the app. Neither window is "the main one".
- Never assume a window is open, visible, or the only one. A feature must keep working when either window is hidden, reloaded, or opened late.

## State ownership

| Kind of state | Owner | Examples |
| --- | --- | --- |
| Shared | Main process, `electron/appStateStore.ts` | sections, threads, messages, active thread, active project, selected backend |
| Window-local | That window's Zustand store or React state | chat draft, open sidebar page, sidebar and panel toggles, expanded folders |
| Long-running output | Main process, `electron/streams/streamHub.ts`, by stream id | AI replies, terminal output |

- A window changes shared state only by sending an action (`electronAPI.dispatch`). It never edits its copy directly; the copy changes when main broadcasts the next snapshot.
- New shared behaviour is a new action in `shared/appState.ts`, with a `parseAction()` case and tests. An action names the thing it changes by id (for example `threadId`) rather than relying on "the active one".
- State that must be trusted is set by main, not by a renderer action. The active project is set inside `fs:selectFolder`.
- Anything both windows can see is owned by main and addressed by an id, never by a window. There is one active project for the whole app.

## IPC patterns

- **Request/response:** `ipcRenderer.invoke` to a handler registered with `handleFromAppWindow()` (`electron/ipc/handle.ts`). It rejects senders that are not app windows and returns `IpcResult<T>` (`{ ok: true, value } | { ok: false, error }`) instead of throwing.
- **State channels (`state:*`):** small, consistent data, broadcast to every window as a versioned snapshot. A window ignores a snapshot that is not newer than the one it has.
- **Stream channels (`stream:*`):** large or append-only data (AI text, terminal output, artifact bodies) as keyed, batched deltas that main buffers for replay. Never put this data in a state snapshot.
  - A producer in main calls `hub.create()` and writes through the returned `StreamWriter`; it must stop when `writer.signal` aborts (a cancel from any window).
  - A window registers `onStreamData` first, then calls `subscribeStream(id, knownChunks)`; main replies with the chunks from `knownChunks` on, then live ones every ~30 ms. `useStream` does this.
  - A delta's `startIndex` says where its chunks go. A window skips chunks it already has and re-subscribes when a delta would leave a gap.
  - Once a finished stream's text is stored elsewhere, call `hub.release(id)`.
- Every payload that arrives in main is `unknown` and is validated before use.
- The bridge exposes one method per channel. `ipcRenderer` and IPC event objects are never exposed. A subscription method returns an unsubscribe function.
- Adding a domain `<d>` means adding `shared/ipc/<d>.ts`, `electron/ipc/<d>.ts`, and `electron/preload/<d>.ts`, plus one registration line each in `electron/main.ts`, `electron/preload.ts`, and `shared/electronApi.ts`.

## Conventions

- Import direction: `src/` and `electron/` import from `shared/`. `shared/` imports only from `shared/`. `src/` never imports from `electron/`, and `electron/` never imports from `src/`. `tests/processIsolation.test.ts` enforces this.
- `fs:readDir` only reads inside folders the user picked through the native dialog (`ProjectFileAccess` in `electron/projectFiles.ts`). Keep that check when adding file handlers.
- `window.electronAPI` is typed as optional; renderer code must handle it being absent (use `getBridge()` in `src/lib/bridge.ts`).
- Secrets (API keys, tokens) never go in the repo, the renderer, shared state, or logs. The production Content-Security-Policy blocks network requests from the renderer; AI backends must be reached through the main process.

## Testing criteria

- Logic that can be pure is pure and unit-tested: state changes in `shared/`, access rules and stores in Electron-free files under `electron/`.
- Every new action has tests for its effect and for `parseAction()` rejecting malformed input.
- Anything synchronised between windows has a test with two window stores attached to one main store (see `tests/useAppStore.test.ts`).
- Do not weaken or delete a test to make it pass. A test that describes behaviour a phase removes is replaced only with the user's sign-off.
- Unit tests do not prove the windows work. Each phase also needs its check observed in the running app with both windows open.
