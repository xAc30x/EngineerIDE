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

CI (`.github/workflows/ci.yml`) runs the first three items on every pull
request. A red CI run means the phase is not done.

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
| 2a | Stream channel | Done |
| 2b | Provider contract | Done |
| 2c | Claude CLI provider | Done |
| 2d | API-key providers | Done |
| 3a | SQLite driver decision | Done |
| 3b | Storage layer | `[x]` Done |
| 3c | Load on demand | Not started |
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

**As built.**
- `electron/streams/streamHub.ts` (no Electron imports) owns the streams.
  `create()` returns a `StreamWriter` (`id`, `signal`, `append`, `complete`,
  `fail`, `finished`); `cancel`, `release`, `getText`, `getStatus`, and
  `dispose` cover the rest. Each subscriber has a cursor, so replay and live
  chunks use the same path and never repeat or skip a chunk.
- `registerStreamsIpc()` creates the hub and returns it; Phase 2b keeps that
  return value in `electron/main.ts` and passes it to its own domain.
- Main sends `StreamDelta`s (`streamId`, `startIndex`, `chunks`, `status`,
  `error`) on `stream:data` to the windows that subscribed. Every delta carries
  the status; finishing sends pending chunks with the final status at once.
- `src/hooks/useStream.ts` follows one stream in a window. Its pure
  `applyStreamDelta()` skips chunks the window has and reports a gap instead
  of leaving a hole. `createStreamFollowers()` shares one subscription per
  stream between all consumers in a window.
- `electronAPI.startTestStream()` starts a fake numbered stream
  (`electron/streams/testStream.ts`). It is refused in a packaged app.
- No component mounts `useStream` yet; Phase 2b's chat is its first user.

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

**As built.**
- `electron/ai/adapter.ts` holds `AIProviderAdapter`, `AIChatRequest` (with a
  required `signal`), and `AIStreamEvent`. `shared/types.ts` keeps only the
  serialisable `BackendProvider`, `AIProviderStatus`, and `ProviderAvailability`.
- `ProviderRegistry` (`registry.ts`) maps a backend to its adapter. Built with
  `allowTestStandIn: !app.isPackaged`, so in development a backend with no
  adapter answers with `createFakeProvider` (about 10 s, prefixed
  `[Test reply] `) and is listed as available; a packaged build refuses with
  "<label> is not available yet." Phases 2c/2d call `registry.register()`.
- `ReplyRunner` (`replies.ts`) is the only way a reply starts. `send()`
  validates first, then, with no `await` until the lock is taken, refuses a
  thread whose `runningReply` is set, creates a thread if needed, and
  dispatches `sendMessage`, `hub.create()`, and `startReply`. A refused send
  changes nothing. Async provider checks belong before the lock check. When the
  stream finishes, `finishReply` is dispatched, then `hub.release()` (in a
  `finally`).
- `Thread.runningReply: { streamId, provider } | null` is the run lock both
  windows see. `startReply`/`finishReply` are main-only `SharedAction`s.
  `replyOutcomeMessages()` stores a completed reply as an assistant message,
  and keeps a stopped or failed reply's partial text followed by a system note
  ("Reply stopped." / "The reply failed: …"). System notes are not sent to
  providers.
- `ai:sendMessage`, `ai:cancelReply` (by thread id), `ai:listProviders`.
  `ChatPanel` sends through `sendChatMessage`, shows the running reply with
  `useStream` and a Stop button, shows a refusal under the input, and marks
  unavailable backends in the selector.
- The `sendMessage` action stays a `RendererAction` (it adds a message with no
  reply); the chat uses it only when there is no bridge.

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

**As built.**
- `createClaudeCliProvider()` (`electron/ai/providers/claudeCli.ts`) runs one
  `claude --print --output-format stream-json --include-partial-messages`
  child per reply, in the active project folder. Tools and MCP servers are
  off (`--tools ""`, `--strict-mcp-config`), so it is chat only. The user's
  `~/.claude` settings are skipped (`--setting-sources ""`), so their hooks and
  output style do not run or change replies; sign-in still works. Sessions are
  not saved (`--no-session-persistence`).
- `buildPrompt()` writes the conversation into one prompt (`User:` /
  `Assistant:` turns, system notes left out), sent on stdin, never as an
  argument. A single message is sent as it is.
- `parseStreamLine()` turns `text_delta` events into text and the `result`
  line into completed or an error. A reply whose text arrives only in the
  result is still shown.
- `checkAvailability()` runs `claude --version` (missing: "Claude CLI not
  found") and `claude auth status --json`, reading only `loggedIn` (false:
  "not signed in"). Nothing from the status output is stored or logged.
- Cancel sends SIGTERM, then SIGKILL after 2 s. `stopAll()` kills every
  running child; `electron/ipc/ai.ts` registers the provider and calls it on
  `will-quit` (approved edit outside Owns).
- `spawn` is injectable, so `tests/ai.claudeCli.test.ts` uses a fake child
  process and never runs the real CLI.
- On Windows only a `claude.exe` on PATH is found
  (no shell, so an npm `claude.cmd` shim is not); not yet tested on Windows.

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

**As built.**
- `KeyStore` (`electron/secrets/keyStore.ts`, no Electron imports) keeps one
  encrypted key per backend in `api-keys.json` in the user data folder
  (written through a temporary file, mode 0600). `setKey`/`clearKey` validate
  their `unknown` input (`parseApiKey`: printable ASCII, no spaces, at most 512
  characters) and are serialised so two saves cannot overwrite each other.
  `getKey` decrypts only when a reply starts; nothing else reads the key.
- `electron/ipc/secrets.ts` supplies the cipher: Electron `safeStorage`'s async
  API. On Linux it refuses the `basic_text` fallback (no keyring), so saving
  fails with a message instead of storing a weakly protected key.
- `secrets:setApiKey`, `secrets:clearApiKey`, `secrets:listApiKeys`
  (`{ id, isSet }[]`). There is no channel that returns a key.
- `anthropicApi.ts` (Messages API, `anthropic-version: 2026-10-21`, default
  model `claude-opus-5-5`) and `openAiCompatible.ts` (Chat Completions; OpenAI
  default `gpt-6-luna`, OpenRouter default `anthropic/claude-opus-5.5`) stream
  with the global `fetch` (no new dependency); `http.ts` holds the shared SSE
  reader and messages. `fetch` is injectable for tests.
- Errors never carry text from the service or from a thrown error (OpenAI
  quotes part of a rejected key): an HTTP error is reported by status only, a
  mid-stream error by its type name only.
- A backend with no key is listed as unavailable ("No API key saved. Add one in
  Settings."). `ChatPanel` re-checks availability when its window gets focus
  (approved edit outside Owns).
- Settings: the sidebar's gear opens a `settings` page (`NavTab` gained
  `settings`) with `src/components/settings/ApiKeySettings.tsx`, which clears
  the field as soon as Save is pressed.
- `tests/secrets.noLeak.test.ts` runs the real `ReplyRunner`, `StreamHub`,
  `AppStateStore` and `KeyStore` against a fake server that echoes the key in a
  401, a mid-stream error and a thrown error, for all three backends, and
  checks that the key (and its first 12 characters) appears in no snapshot,
  stream delta, IPC result, or the file at rest.
- App check (2026-11-16, both windows): a key saved in Settings was still
  set after a restart, and the Anthropic API accepted it (HTTP 400 for an
  account without credit, shown with the out-of-credit hint). A live streamed
  reply from an API-key provider was not observed for lack of credit; the user
  accepted the phase as done without it.

---

## Milestone 3 – Persistence

Detailed when it is next. Module-level plan:

- **3a – Driver decision.** A short spike that picks the SQLite driver and
  records the decision here. It must check whether the Node version bundled
  with the installed Electron provides a built-in SQLite module before adding
  a native dependency, and whether queries run in main or in a worker thread.
  A synchronous driver in main blocks IPC for both windows.

  **Decision (2026-11-17): the built-in `node:sqlite` module, with every query
  run in a worker thread.** No native dependency is added.
  - Checked: the installed Electron 45.3.2 bundles Node 24.22.2, which provides
    `node:sqlite` (`DatabaseSync`, SQLite 3.53.4). Run as Node inside that
    Electron binary, it created a table, wrote and read a row, and did the same
    inside a `worker_threads` worker. No experimental warning was printed.
  - Why a worker: `DatabaseSync` is synchronous, so a query blocks the thread
    that runs it. In main that would stall IPC for both windows; in a worker
    only the worker waits.
  - Options not chosen: `node:sqlite` directly in main (simplest, but blocks
    IPC); `better-sqlite3` (a native module that must be rebuilt for each
    Electron version: kept as the fallback if `node:sqlite` falls short).
  - `tests/sqliteDriver.test.ts` checks the module in the test runtime, in a
    worker, and in the installed Electron's own Node, so an upgrade that drops
    it fails the tests.
  - Left for 3b: the worker script must be bundled as its own entry with
    `node:sqlite` kept external, and the main-to-worker message layer is new
    code. No running-app check was possible for this decision-only phase (it
    adds nothing visible); the checks above ran in Electron's runtime without
    windows. The first in-app check is 3b's.
- **3b – Storage layer.** `electron/storage/`: schema, migrations, and one
  writer, in main. No window opens the database. Detailed below.
- **3c – Load on demand.** The state snapshot becomes a thread index (ids,
  titles, sections); messages load per thread. Restore the last project,
  thread, and window positions on launch.

### Phase 3b – Storage layer

Status: `[x]` Done (2026-11-17).

**Goal.** A SQLite database in the user data folder, created and upgraded by
numbered migrations, and one writer in main that saves threads and messages as
they change. Nothing is read back yet: loading is 3c.

**Owns.** `electron/storage/` (schema, migrations, the worker, the main-side
client, the writer), `tests/storage.*.test.ts`, and the one start-up line in
`electron/main.ts`, plus the worker entry in `vite.config.ts` (outside the
list; the user approved it for this phase).

**Rules.**
- Every query runs in one worker thread (Phase 3a). Main only sends messages.
- One writer: only `electron/storage/` writes to the database, in order.
- Write-only in 3b. Threads and messages are inserted or updated as they
  change in this session; nothing is deleted, because 3b never loads data and
  a "make the file match memory" writer would wipe the previous session.
- Sections are not stored yet: the built-in sections get new random ids on
  every launch and would pile up as duplicates. 3c stores them.
- A thread's `runningReply` and stream text are never stored; a reply is
  stored once it finishes, as messages.
- If the database cannot open or a write fails, the app keeps working in
  memory. Errors are fixed messages. No secret goes in the database.
- No change to `src/`, `shared/`, the preload, or IPC.

**Done when.**
- Migrations create the schema on an empty database, are recorded in
  SQLite's `user_version`, and running them twice changes nothing (tests).
- The worker's request handler and the main-side client are tested without
  Electron; the client reports a dead or failing worker as an error value.
- The writer saves new threads, title changes and new messages, and never
  deletes (tests).
- `npm run build` emits the worker as its own file in `dist-electron/` with
  `node:sqlite` kept as an import.
- App check, both windows open: send a message, quit, and the thread and
  message are in the database file.

**As built.**
- `electron/storage/`: `schema.ts` (migration 1: `threads` and `messages`,
  `STRICT`, a role check, unique `(thread_id, position)`, messages reference
  their thread), `migrations.ts` (each migration and its `user_version` bump in
  one transaction; a database newer than the app is refused and left
  untouched), `protocol.ts`, `handler.ts` (validates every request; `open`
  turns on foreign keys and WAL and migrates; `write` applies a batch
  all-or-nothing; threads upsert title and `updated_at`, messages are
  insert-only), `worker.ts`, `client.ts`, `writer.ts`, `index.ts`.
- The database is `engineeride.db` in Electron's user data folder
  (`~/.config/engineer-ide/` on Linux). `startStorage(appState)` is the one
  line in `electron/main.ts`.
- `vite.config.ts` builds `electron/storage/worker.ts` to
  `dist-electron/storage-worker.js` (shared code lands in a small chunk next
  to it); `node:sqlite` stays an import. The built worker was also run inside
  the installed Electron's Node against a scratch file.
- Quitting waits for the writes already sent, at most 3 seconds, then quits.
  Any storage failure prints one `[storage]` warning with a fixed message and
  the app carries on in memory.
- Tests: `tests/storage.migrations.test.ts`, `tests/storage.worker.test.ts`
  (handler on an in-memory database; client against a fake worker, including a
  crash and an exit), `tests/storage.writer.test.ts` (272 tests in all).
- App check (2026-11-17, both windows, `npm run build && npm start`): one
  message from each window with finished replies, quit, then a second launch
  with more messages. The file held 2 threads and 4 user and 4 assistant
  messages, with the first launch's rows still there, at schema version 1 and
  with no foreign key problems.
- Left for 3c: loading on start; storing sections (the built-in Work and
  Personal sections get new random ids each launch, so they need fixed ids
  first); a reply still running at quit is not saved; a write that fails is
  not retried.

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
