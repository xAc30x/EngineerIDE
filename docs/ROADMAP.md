# EngineerIDE roadmap

This file is the build plan. Each phase is written to be executed on its own,
by a session that has read only this file and [CLAUDE.md](../CLAUDE.md).

## How to work a phase

1. Work on exactly one phase. Do not start the next one in the same change.
2. Stay inside the phase's **Owns** paths. Editing anything else needs the
   user's approval first. Two exceptions are always allowed:
   - one registration line per new domain in `electron/main.ts`,
     `electron/preload.ts`, and `shared/electronApi.ts`;
   - `CLAUDE.md`, `README.md`, and this file, to describe what the phase added.
3. Add at most one native (compiled) dependency per phase, and only when the
   phase names it.
4. A phase is finished only when its **Done when** list and the shared
   definition of done below are both met.

### Shared definition of done

- `npx tsc --noEmit` reports no errors.
- `npm test` passes, including the tests the phase names. No existing test is
  weakened or deleted; a test that describes removed behaviour is replaced
  only with the user's sign-off.
- `npm run build` succeeds.
- The phase's check is observed in the running app with **both windows open**.
- `CLAUDE.md`, `README.md`, and the phase's status in this file are updated.

## Architecture the phases build on

- **Two windows.** The Workspace window (chat hub, projects, artifacts,
  scheduled tasks) and the IDE window (explorer, editor, agent chat) are
  separate renderer processes. Closing a window affects only that window: it is
  hidden while the other one is on screen, and the app quits when the last
  visible window is closed.
- **Ownership by id, in main.** Anything both windows can see is owned by the
  main process and addressed by an id (thread, stream, terminal session), never
  by a window. A window can hide, reload, or open late and lose nothing.
- **Two kinds of IPC channel.**
  - *State channels* carry small, consistent data as versioned snapshots
    (`state:*`). A window ignores a snapshot older than the one it has.
  - *Stream channels* carry large, append-only data as keyed, batched deltas
    (`stream:*`, added in Phase 2a). Main buffers each stream so a window can
    replay it.
- **One active project app-wide.** Both windows work in the same folder.
- **Per-domain modules.** A domain `<d>` owns `shared/ipc/<d>.ts` (channel
  names, payload types, its part of the bridge API), `electron/ipc/<d>.ts`
  (handlers), and `electron/preload/<d>.ts` (bridge methods).

## Status

| Phase | Title | Status |
| --- | --- | --- |
| 0 | Two-window architecture | Done |
| 2a | Stream channel | Not started |
| 2b | Provider contract | Not started |
| 2c | Claude CLI provider | Not started |
| 2d | API-key providers | Not started |
| 3a–3c | Persistence | Not started |
| 4a–4c | Files and editor | Not started |
| 5a–5b | Terminal | Not started |
| 6a–6c | Artifacts | Not started |
| 7 | Scheduled tasks | Not started |
| 8 | Packaging | Not started |

Milestone 1 (the single-window shell) is complete. There is no Phase 1.

---

## Phase 0 – Two-window architecture

**Goal.** Replace the single-window view swap with two independent windows
whose shared state lives in the main process.

**Owns.** `shared/`, `electron/`, `src/store/`, `src/lib/`, `src/App.tsx`,
`src/main.tsx`, `src/components/shell/`, `src/hooks/useProjectFolder.ts`,
`src/types/`, `tests/`, `tsconfig.json`, and one-line import or wording changes
in other components.

**Design.**
- `shared/appState.ts` holds the pure state logic: `SharedState`,
  `applyAction()`, and `parseAction()`, which validates untrusted IPC payloads.
- `electron/appStateStore.ts` owns the state, applies actions, and bumps a
  version number on every change.
- `electron/windows.ts` is the window registry: focus-or-create, the close and
  quit rules, and the list of trusted IPC senders.
- Each window's `src/store/useAppStore.ts` mirrors the snapshots and sends
  actions over the bridge. It subscribes before fetching the first snapshot.
- Window-local state: the chat draft, the open sidebar page, and the sidebar
  and artifacts-panel toggles.
- `sendMessage` carries the id of the thread the sending window is showing.
- The active project is set by main inside `fs:selectFolder`; a renderer never
  supplies a trusted path.

**Done when.**
- A message sent in either window appears in the other.
- Selecting a thread or a folder in one window updates the other.
- The header button (`IDE` in the Workspace window, `Agent Window` in the IDE
  window) and `Ctrl+E` open or focus the other window; neither closes.
- Closing either window hides only that window while the other is on screen,
  and reopening it keeps its state; closing the last visible window quits the
  app and leaves no process behind.
- Tests cover: the state logic, payload validation, snapshot versioning, two
  window stores staying in sync through one main store, and the import rules
  for `shared/`, `src/`, and `electron/`.

---

## Milestone 2 – Streaming AI

### Phase 2a – Stream channel

**Goal.** A way for main to send long, incremental output to any window.

**Owns.** `electron/streams/`, `shared/ipc/streams.ts`,
`electron/ipc/streams.ts`, `electron/preload/streams.ts`,
`src/hooks/useStream.ts`, `tests/streams*.test.ts`.

**Must not touch.** UI components, `shared/appState.ts`, the state store.

**Design.**
- A stream has an id, a status (`running`, `completed`, `failed`,
  `cancelled`), and an ordered list of text chunks held in main.
- Main batches chunks (about every 30 ms) before sending them.
- A window subscribes with the stream id and the number of chunks it already
  has; main replies with the missing chunks, then live ones.
- `stream:cancel` works from either window.
- Finished streams are dropped from the buffer once their text is stored in
  shared state.

**Done when.**
- A test provider's output appears in both windows as it is produced.
- A window reloaded mid-stream shows the full text so far, then continues.
- Cancelling from the window that did not start the stream stops it.
- Tests cover batching, replay from an offset, cancel, and cleanup.

### Phase 2b – Provider contract

**Goal.** Chat messages get a reply from a provider that runs in main.

**Owns.** `electron/ai/` (adapter interface, provider registry, per-thread run
lock, a fake provider for tests), `shared/ipc/ai.ts`, `electron/ipc/ai.ts`,
`electron/preload/ai.ts`, the AI section of `shared/types.ts`,
`src/components/shared/ChatPanel.tsx`, the `sendMessage` case in
`shared/appState.ts`, `tests/ai*.test.ts`.

**Must not touch.** `electron/streams/` (use it, do not change it).

**Design.**
- `AIProviderAdapter` moves to `electron/ai/` and keeps `AbortSignal` and
  `AsyncIterable`, which cannot cross IPC.
- Renderers get a serialisable contract: start a reply for a thread (returns a
  stream id), cancel it, and list provider availability.
- Main allows one running reply per thread and refuses a second with a clear
  message. The thread records its running stream id in shared state so both
  windows show the same reply.
- When a stream completes, main writes the assistant message into shared state.
- The Milestone 1 "not connected" system notice is removed.

**Done when.**
- The fake provider's reply streams into the chat in both windows.
- Sending to a thread that is already replying is refused with a message.
- Tests cover the run lock, completion writing the message, and failure.

### Phase 2c – Claude CLI provider

**Goal.** The first real provider, using the locally installed Claude CLI.

**Owns.** `electron/ai/providers/claudeCli.ts`, its test file.

**Must not touch.** The rest of `electron/ai/`.

**Done when.**
- A real reply streams into both windows.
- When the CLI is missing or not signed in, the backend selector shows why.
- Cancelling ends the child process. No child process survives app quit.

### Phase 2d – API-key providers

**Goal.** Anthropic API, OpenRouter, and OpenAI API providers.

**Owns.** `electron/ai/providers/`, `electron/secrets/` (keys stored with the
operating system's keychain through Electron `safeStorage`),
`shared/ipc/secrets.ts`, `electron/ipc/secrets.ts`,
`electron/preload/secrets.ts`, a settings form under `src/components/settings/`.

**Rules.** A key goes from the settings form to main once and never comes back
to a renderer. Keys never appear in shared state, logs, error messages, or the
repo. Renderers learn only whether a key is set.

**Done when.**
- Each provider streams a reply once its key is saved.
- Keys survive a restart.
- A test proves no key appears in a state snapshot or a stream.

---

## Milestone 3 – Persistence

Detailed when it is next. Module-level plan:

- **3a – Driver decision.** A short spike that picks the SQLite driver and
  records the decision here. It must check whether the Node version bundled
  with the installed Electron provides a built-in SQLite module before adding
  a native dependency, and whether queries run in main or in a worker thread.
  A synchronous driver in main blocks IPC for both windows.
- **3b – Storage layer.** `electron/storage/`: schema, migrations, and one
  writer, in main. No window opens the database.
- **3c – Load on demand.** The state snapshot becomes a thread index (ids,
  titles, sections); messages load per thread. Restore the last project,
  thread, and window positions on launch.

## Milestone 4 – Files and editor

- **4a – Read and write.** File read and write handlers behind
  `ProjectFileAccess`. A save sends the modification time the file had when it
  was read; main refuses the save if the file changed on disk since then.
- **4b – Editor.** A pure-JavaScript code editor in the IDE window, with
  unsaved-change tracking. Adds a quit guard to `electron/windows.ts`: closing
  the last visible window asks before discarding unsaved files, including
  those in a hidden IDE window.
- **4c – File watching.** `electron/watch/`: one watcher per project root, in
  main. A hidden IDE window receives nothing and refreshes when shown.

## Milestone 5 – Terminal

- **5a – Session manager.** `electron/terminal/`: terminal processes owned by
  main and addressed by session id, with a scrollback buffer for replay over a
  stream channel, and kill-on-quit. Native dependency: `node-pty`.
- **5b – Terminal UI.** A terminal panel in the IDE window.

## Milestone 6 – Artifacts

- **6a – Model and list.** Artifacts stored through `electron/storage/` and
  listed on the Artifacts page.
- **6b – Preview.** Generated HTML is untrusted. It renders in a sandboxed
  iframe served from a dedicated protocol with its own strict
  Content-Security-Policy, no preload script, and no access to
  `window.electronAPI`.
- **6c – Live updates.** The preview follows a running reply over a stream
  channel.

## Milestone 7 – Scheduled tasks

A scheduler in main that starts replies through `electron/ai/`.

## Milestone 8 – Packaging

Installers for Linux and Windows.
