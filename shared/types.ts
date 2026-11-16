/**
 * Core contracts shared by the renderer (`src/`) and the Electron main
 * process (`electron/`). This file must stay free of runtime code and of
 * Node/Electron imports. Bridge APIs live next to their channels in
 * `shared/ipc/`.
 */

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/** The two application windows. Each one renders its own layout. */
export type WindowKind = 'workspace' | 'ide';

/** Pages of the Workspace window. `chat` is the conversation view. */
export type NavTab = 'chat' | 'projects' | 'artifacts' | 'scheduled' | 'design' | 'settings';

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** Unix time in milliseconds. */
  createdAt: number;
}

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  /** Unix time in milliseconds. */
  createdAt: number;
  /** Unix time in milliseconds. */
  updatedAt: number;
  /** The reply being produced for this thread, or `null`. Set by the main process only. */
  runningReply: RunningReply | null;
}

/** A reply in progress. Its text is in the stream with this id until it finishes. */
export interface RunningReply {
  streamId: string;
  provider: BackendProvider;
}

/** `pinned` is the single built-in section; `custom` sections are user-created. */
export type SectionKind = 'pinned' | 'custom';

export interface Section {
  id: string;
  title: string;
  kind: SectionKind;
  isCollapsed: boolean;
  items: Thread[];
}

// ---------------------------------------------------------------------------
// File system and IPC
// ---------------------------------------------------------------------------

export interface FileNode {
  name: string;
  /** Absolute path, built by the main process. The renderer never edits it. */
  path: string;
  isDirectory: boolean;
}

export interface SelectedFolder {
  /** Absolute path of the folder. */
  path: string;
  /** Last path segment, for display. */
  name: string;
}

/** Result of an IPC call. Handlers report failures as values instead of throwing. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------

export type BackendProvider = 'claude-cli' | 'openrouter' | 'anthropic-api' | 'openai-api';

export interface AIProviderStatus {
  available: boolean;
  /** Explains why the provider cannot be used, for display to the user. */
  reason?: string;
}

/** One backend's availability, as the backend selector shows it. Serialisable. */
export interface ProviderAvailability extends AIProviderStatus {
  id: BackendProvider;
  label: string;
}

/**
 * The adapter interface itself (`AIProviderAdapter`) lives in
 * `electron/ai/adapter.ts`: it uses `AbortSignal` and `AsyncIterable`, which
 * cannot cross IPC, and providers run only in the main process.
 */
