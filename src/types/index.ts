/**
 * Core contracts shared by the renderer (`src/`) and, as types only, by the
 * Electron main process (`electron/`). This file must stay free of runtime
 * code and of Node/Electron imports.
 */

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export type AppMode = 'workspace' | 'ide';

export type NavTab = 'chat' | 'projects' | 'artifacts' | 'scheduled' | 'design';

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
// File system bridge
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

/** The API exposed on `window.electronAPI` by `electron/preload.ts`. */
export interface ElectronAPI {
  /** Node's `process.platform` value, for example `linux`, `win32`, or `darwin`. */
  readonly platform: string;
  /** Opens the native folder dialog. Resolves with `null` when the user cancels. */
  selectFolder(): Promise<IpcResult<SelectedFolder | null>>;
  /** Lists one folder level. The folder must be inside a previously selected folder. */
  readDir(dirPath: string): Promise<IpcResult<FileNode[]>>;
}

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------

export type BackendProvider = 'claude-cli' | 'openrouter' | 'anthropic-api' | 'openai-api';

export interface AIChatRequest {
  /** Full conversation so far, oldest first. */
  messages: readonly Message[];
  /** Folder the conversation is working in, if one is selected. */
  projectPath: string | null;
  /** Provider-specific model name. The adapter picks its default when omitted. */
  model?: string;
  /** Lets the caller cancel a running request. */
  signal?: AbortSignal;
}

export type AIStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'completed' }
  | { type: 'error'; message: string };

export interface AIProviderStatus {
  available: boolean;
  /** Explains why the provider cannot be used, for display to the user. */
  reason?: string;
}

/**
 * One implementation per backend. UI components depend only on this
 * interface, so a backend can be added or replaced without changing them.
 */
export interface AIProviderAdapter {
  readonly id: BackendProvider;
  /** Name shown in the backend selector. */
  readonly label: string;
  /** Reports whether the backend is installed/configured and ready to use. */
  checkAvailability(): Promise<AIProviderStatus>;
  /** Sends the conversation and yields the reply as it is produced. */
  streamChat(request: AIChatRequest): AsyncIterable<AIStreamEvent>;
}
