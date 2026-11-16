import { useCallback, useEffect, useState } from 'react';
import type { StreamDelta, StreamStatus } from '../../shared/ipc/streams';
import { getBridge } from '../lib/bridge';

const BRIDGE_UNAVAILABLE_ERROR = 'Streams are only available in the desktop app.';

/** What one window knows about one stream. */
export interface StreamView {
  chunks: string[];
  /** `null` until main has answered the subscription. */
  status: StreamStatus | null;
  /** Why the stream failed, or why this window could not follow it. */
  error: string | null;
}

export const EMPTY_STREAM_VIEW: StreamView = { chunks: [], status: null, error: null };

export type DeltaOutcome = 'applied' | 'gap';

/**
 * Adds a delta to what the window has. Chunks the window already holds are
 * skipped, so a replay that overlaps live data does not repeat text. A delta
 * that starts after the window's last chunk would leave a hole: it is not
 * applied and the outcome is `gap`, so the caller can subscribe again.
 */
export function applyStreamDelta(
  view: StreamView,
  delta: StreamDelta,
): { view: StreamView; outcome: DeltaOutcome } {
  const have = view.chunks.length;
  if (delta.startIndex > have) {
    return { view, outcome: 'gap' };
  }
  const fresh = delta.chunks.slice(have - delta.startIndex);
  return {
    view: {
      chunks: fresh.length === 0 ? view.chunks : [...view.chunks, ...fresh],
      status: delta.status,
      error: delta.status === 'failed' ? (delta.error ?? 'The stream failed.') : view.error,
    },
    outcome: 'applied',
  };
}

export interface StreamState {
  /** All chunks this window has, joined. */
  text: string;
  chunkCount: number;
  status: StreamStatus | null;
  error: string | null;
  /** Stops the stream for every window. */
  cancel: () => Promise<void>;
}

/**
 * Follows one stream owned by the main process. On mount (or after a reload)
 * it receives the text so far, then the rest as it is produced. Pass `null`
 * to follow nothing.
 */
export function useStream(streamId: string | null): StreamState {
  const [view, setView] = useState<StreamView>(EMPTY_STREAM_VIEW);

  useEffect(() => {
    setView(EMPTY_STREAM_VIEW);
    if (streamId === null) {
      return undefined;
    }
    const api = getBridge();
    if (api === undefined) {
      setView({ ...EMPTY_STREAM_VIEW, error: BRIDGE_UNAVAILABLE_ERROR });
      return undefined;
    }

    let isActive = true;
    // Kept outside React state so the listener sees every delta in order.
    let current = EMPTY_STREAM_VIEW;

    const subscribe = (knownChunks: number): void => {
      api
        .subscribeStream(streamId, knownChunks)
        .then((result) => {
          if (isActive && !result.ok) {
            current = { ...current, error: result.error };
            setView(current);
          }
        })
        .catch((cause: unknown) => {
          if (isActive) {
            current = { ...current, error: cause instanceof Error ? cause.message : String(cause) };
            setView(current);
          }
        });
    };

    // Listen first, then subscribe, so nothing sent in between is missed.
    const stopListening = api.onStreamData((delta) => {
      if (!isActive || delta.streamId !== streamId) {
        return;
      }
      const { view: next, outcome } = applyStreamDelta(current, delta);
      if (outcome === 'gap') {
        subscribe(current.chunks.length);
        return;
      }
      current = next;
      setView(current);
    });
    subscribe(0);

    return () => {
      isActive = false;
      stopListening();
      void api.unsubscribeStream(streamId);
    };
  }, [streamId]);

  const cancel = useCallback(async () => {
    const api = getBridge();
    if (streamId === null || api === undefined) {
      return;
    }
    const result = await api.cancelStream(streamId);
    if (!result.ok) {
      setView((previous) => ({ ...previous, error: result.error }));
    }
  }, [streamId]);

  return {
    text: view.chunks.join(''),
    chunkCount: view.chunks.length,
    status: view.status,
    error: view.error,
    cancel,
  };
}
