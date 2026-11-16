import { ArrowUp, FolderOpen, Info } from 'lucide-react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { BACKEND_OPTIONS, isBackendProvider } from '../../config/backends';
import { useProjectFolder } from '../../hooks/useProjectFolder';
import { selectActiveThread, useAppStore } from '../../store/useAppStore';
import type { Message } from '../../types';

/** `centered` is the wide Workspace layout; `docked` fits the narrow IDE side panel. */
export type ChatPanelVariant = 'centered' | 'docked';

interface ChatPanelProps {
  variant: ChatPanelVariant;
}

interface VariantLayout {
  column: string;
  greeting: string;
  folderLabel: string;
  inputRows: number;
}

const LAYOUTS: Readonly<Record<ChatPanelVariant, VariantLayout>> = {
  centered: {
    column: 'mx-auto w-full max-w-3xl px-6',
    greeting: 'text-3xl',
    folderLabel: 'max-w-48',
    inputRows: 3,
  },
  docked: {
    column: 'w-full px-3',
    greeting: 'text-lg',
    folderLabel: 'max-w-24',
    inputRows: 2,
  },
};

function MessageItem({ message }: { message: Message }) {
  switch (message.role) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl bg-surface px-4 py-2.5 leading-relaxed break-words whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="leading-relaxed break-words whitespace-pre-wrap">{message.content}</div>
      );
    case 'system':
      return (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted"
        >
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{message.content}</span>
        </div>
      );
  }
}

/**
 * Conversation view and message input. Both modes render this component
 * against the same store state, so the thread, the unsent draft, and the
 * selected backend are identical in Workspace Mode and IDE Mode.
 */
export function ChatPanel({ variant }: ChatPanelProps) {
  const layout = LAYOUTS[variant];
  const thread = useAppStore(selectActiveThread);
  const draft = useAppStore((state) => state.composerDraft);
  const selectedBackend = useAppStore((state) => state.selectedBackend);
  const setComposerDraft = useAppStore((state) => state.setComposerDraft);
  const setSelectedBackend = useAppStore((state) => state.setSelectedBackend);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const { projectPath, projectName, error: folderError, selectFolder } = useProjectFolder();

  const messages = thread?.messages ?? [];
  const canSend = draft.trim() !== '';

  const submit = () => {
    if (!canSend) {
      return;
    }
    sendMessage(draft);
    setComposerDraft('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter adds a line. Enter that confirms an input
    // method composition (for example Japanese or Chinese) must not send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const handleBackendChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (isBackendProvider(value)) {
      setSelectedBackend(value);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length === 0 ? (
        <div className={`flex min-h-0 flex-1 flex-col items-center justify-center ${layout.column}`}>
          <p className={`text-center font-medium text-fg ${layout.greeting}`}>
            What would you like to work on?
          </p>
          <p className="mt-2 text-center text-sm text-subtle">
            Messages are kept in memory until the app closes.
          </p>
        </div>
      ) : (
        // A reversed column keeps the view scrolled to the newest message
        // without scripting. The spacer keeps short threads at the top.
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
          <div className="flex-1" />
          <div className={`flex flex-col gap-4 py-6 ${layout.column}`}>
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className={`shrink-0 pb-4 ${layout.column}`}>
        <div className="rounded-2xl border border-line bg-surface transition-colors focus-within:border-subtle">
          <textarea
            value={draft}
            onChange={(event) => setComposerDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={layout.inputRows}
            placeholder="Write a message…"
            aria-label="Message"
            className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-fg outline-none placeholder:text-subtle"
          />
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <button
              type="button"
              onClick={() => void selectFolder()}
              title={projectPath ?? 'Select a project folder'}
              className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <FolderOpen className="size-3.5 shrink-0" aria-hidden />
              <span className={`truncate ${layout.folderLabel}`}>
                {projectName ?? 'Select folder'}
              </span>
            </button>

            <select
              value={selectedBackend}
              onChange={handleBackendChange}
              aria-label="AI backend"
              className="h-7 min-w-0 cursor-pointer rounded-md bg-transparent px-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              {BACKEND_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="flex-1" />

            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              title="Send message (Enter)"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        {folderError !== null && (
          <p role="alert" className="mt-1.5 px-1 text-xs text-danger">
            {folderError}
          </p>
        )}
      </form>
    </div>
  );
}
