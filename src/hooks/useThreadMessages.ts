import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Message, ThreadSummary } from '../types';

export interface ThreadMessages {
  /** The messages fetched for this thread, oldest first. */
  messages: Message[];
  /** False while a fetch for the thread's current `messageCount` is on its way. */
  isUpToDate: boolean;
  error: string | null;
}

interface Loaded {
  threadId: string;
  count: number;
  messages: Message[];
  error: string | null;
}

/**
 * The messages of `thread`, fetched from main (Phase 3c): the state snapshot
 * carries only a thread index. Fetches again whenever the thread's
 * `messageCount` changes. While a new fetch is on its way the previous list
 * of the same thread stays on screen, so nothing flickers; a list fetched for
 * another thread is never shown.
 */
export function useThreadMessages(thread: ThreadSummary | undefined): ThreadMessages {
  const loadThreadMessages = useAppStore((state) => state.loadThreadMessages);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const threadId = thread?.id;
  const count = thread?.messageCount ?? 0;

  useEffect(() => {
    if (threadId === undefined || count === 0) {
      return;
    }
    let isCurrent = true;
    loadThreadMessages(threadId)
      .then((result) => {
        if (!isCurrent) return;
        setLoaded((previous) => ({
          threadId,
          count,
          messages: result.ok
            ? result.value
            : previous?.threadId === threadId
              ? previous.messages
              : [],
          error: result.ok ? null : result.error,
        }));
      })
      .catch(() => {
        if (isCurrent) {
          setLoaded({ threadId, count, messages: [], error: 'The messages could not be loaded.' });
        }
      });
    // A response for a thread or count no longer shown is dropped.
    return () => {
      isCurrent = false;
    };
  }, [threadId, count, loadThreadMessages]);

  if (threadId === undefined || count === 0) {
    return { messages: [], isUpToDate: true, error: null };
  }
  if (loaded === null || loaded.threadId !== threadId) {
    return { messages: [], isUpToDate: false, error: null };
  }
  return { messages: loaded.messages, isUpToDate: loaded.count === count, error: loaded.error };
}
