import { ArrowUp, FolderOpen, Info, Square } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { BACKEND_OPTIONS, isBackendProvider } from '../../../shared/backends';
import { useProjectFolder } from '../../hooks/useProjectFolder';
import { useStream } from '../../hooks/useStream';
import { useThreadMessages } from '../../hooks/useThreadMessages';
import { getBridge } from '../../lib/bridge';
import { selectActiveThread, useAppStore } from '../../store/useAppStore';
import type { Message, ProviderAvailability, RunningReply } from '../../types';

/** `centered` is the wide Workspace layout; `docked` fits the IDE window's side panel. */
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
 * The reply being produced, read from its stream. When it finishes, main
 * stores it as a message and clears `runningReply`, which unmounts this.
 */
function StreamingReply({ threadId, reply }: { threadId: string; reply: RunningReply }) {
  const { text, error } = useStream(reply.streamId);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Cancelling by thread (not by stream) lets main decide which reply to stop.
  const stop = async () => {
    const result = await getBridge()?.cancelReply(threadId);
    setCancelError(result === undefined || result.ok ? null : result.error);
  };

  return (
    <div className="flex flex-col gap-2" aria-live="polite" aria-busy="true">
      <div className="leading-relaxed break-words whitespace-pre-wrap">
        {text}
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-muted align-text-bottom" aria-hidden />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void stop()}
          className="flex h-6 items-center gap-1 rounded-md border border-line px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Square className="size-3" aria-hidden />
          Stop
        </button>
        {(error ?? cancelError) !== null && (
          <span role="alert" className="text-xs text-danger">
            {error ?? cancelError}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Each backend's availability, fetched on mount and again whenever the window
 * gets focus, so a key saved in Settings shows up. Empty without a bridge.
 */
function useProviderAvailability(): ProviderAvailability[] {
  const [providers, setProviders] = useState<ProviderAvailability[]>([]);
  useEffect(() => {
    let isMounted = true;
    const refresh = () => {
      getBridge()
        ?.listProviders()
        .then((result) => {
          if (isMounted && result.ok) {
            setProviders(result.value);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      isMounted = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return providers;
}

/**
 * Conversation view and message input. Both windows render this component.
 * The thread and the selected backend are shared through the main process;
 * the unsent draft belongs to each window.
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
  const providers = useProviderAvailability();
  const [sendError, setSendError] = useState<string | null>(null);
  // A ref, not state: a second Enter can arrive before React re-renders.
  const isSendingRef = useRef(false);

  const { messages, isUpToDate } = useThreadMessages(thread);
  const runningReply = thread?.runningReply ?? null;
  const hasMessages = (thread?.messageCount ?? 0) > 0;

  // When a reply ends, its stored message arrives one fetch later. Until it
  // does, the finished stream stays on screen so the reply never blinks out.
  const [lastReply, setLastReply] = useState<{ threadId: string; reply: RunningReply } | null>(
    null,
  );
  useEffect(() => {
    if (thread !== undefined && runningReply !== null) {
      setLastReply({ threadId: thread.id, reply: runningReply });
    } else if (isUpToDate) {
      setLastReply(null);
    }
  }, [thread, runningReply, isUpToDate]);
  const shownReply =
    runningReply ??
    (!isUpToDate && lastReply !== null && lastReply.threadId === thread?.id
      ? lastReply.reply
      : null);
  // Not blocked while replying: main owns the run lock and says why it refuses.
  const canSend = draft.trim() !== '';

  // A refusal stops applying once the reply it was waiting on has ended.
  useEffect(() => {
    if (runningReply === null) {
      setSendError(null);
    }
  }, [runningReply]);

  const submit = async () => {
    if (!canSend || isSendingRef.current) {
      return;
    }
    const bridge = getBridge();
    if (bridge === undefined) {
      // Outside the desktop app there is no provider: keep the message only.
      sendMessage(draft);
      setComposerDraft('');
      return;
    }
    const sent = draft;
    isSendingRef.current = true;
    try {
      const result = await bridge.sendChatMessage(thread?.id ?? null, sent);
      if (result.ok) {
        setSendError(null);
        // Keep anything typed while the request was on its way.
        if (useAppStore.getState().composerDraft === sent) {
          setComposerDraft('');
        }
      } else {
        setSendError(result.error);
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter adds a line. Enter that confirms an input
    // method composition (for example Japanese or Chinese) must not send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
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
      {!hasMessages ? (
        <div className={`flex min-h-0 flex-1 flex-col items-center justify-center ${layout.column}`}>
          <p className={`text-center font-medium text-fg ${layout.greeting}`}>
            What would you like to work on?
          </p>
          <p className="mt-2 text-center text-sm text-subtle">
            Chats are saved on this computer.
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
            {thread !== undefined && shownReply !== null && (
              <StreamingReply key={shownReply.streamId} threadId={thread.id} reply={shownReply} />
            )}
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
              {BACKEND_OPTIONS.map((option) => {
                const availability = providers.find((provider) => provider.id === option.id);
                const isUnavailable = availability?.available === false;
                return (
                  <option key={option.id} value={option.id} title={availability?.reason}>
                    {isUnavailable ? `${option.label} (unavailable)` : option.label}
                  </option>
                );
              })}
            </select>

            <div className="flex-1" />

            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              title={runningReply === null ? 'Send message (Enter)' : 'Replying…'}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        {sendError !== null && (
          <p role="alert" className="mt-1.5 px-1 text-xs text-danger">
            {sendError}
          </p>
        )}
        {folderError !== null && (
          <p role="alert" className="mt-1.5 px-1 text-xs text-danger">
            {folderError}
          </p>
        )}
      </form>
    </div>
  );
}
