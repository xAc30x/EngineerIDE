import { useCallback, useEffect, useState } from 'react';
import type { StreamDelta, StreamsApi, StreamStatus } from '../../shared/ipc/streams';
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

type StreamConsumer = (view: StreamView) => void;

export interface StreamFollowers {
  /**
   * Calls `consumer` with the stream's view now and after every change.
   * Returns a function that stops the calls.
   */
  follow(streamId: string, consumer: StreamConsumer): () => void;
}

interface Follow {
  view: StreamView;
  consumers: Set<StreamConsumer>;
  stop: () => void;
}

/**
 * Follows streams for one window. Main keeps one subscription per window and
 * stream, so every consumer of a stream in this window shares one
 * subscription; it ends when the last consumer stops following.
 */
export function createStreamFollowers(api: StreamsApi): StreamFollowers {
  const follows = new Map<string, Follow>();

  const start = (streamId: string): Follow => {
    let isActive = true;
    // A subscription is on its way; a gap seen before its replay arrives is
    // expected (for example, a delta still addressed to the page before a reload).
    let isAwaitingReplay = false;
    const follow: Follow = { view: EMPTY_STREAM_VIEW, consumers: new Set(), stop: () => {} };

    const update = (view: StreamView): void => {
      follow.view = view;
      for (const consumer of follow.consumers) {
        consumer(view);
      }
    };
    const reportError = (error: string): void => {
      if (isActive) {
        isAwaitingReplay = false;
        update({ ...follow.view, error });
      }
    };
    const subscribe = (knownChunks: number): void => {
      isAwaitingReplay = true;
      api
        .subscribeStream(streamId, knownChunks)
        .then((result) => {
          if (!result.ok) {
            reportError(result.error);
          }
        })
        .catch((cause: unknown) => {
          reportError(cause instanceof Error ? cause.message : String(cause));
        });
    };

    // Listen first, then subscribe, so nothing sent in between is missed.
    const stopListening = api.onStreamData((delta) => {
      if (!isActive || delta.streamId !== streamId) {
        return;
      }
      const { view, outcome } = applyStreamDelta(follow.view, delta);
      if (outcome === 'gap') {
        if (!isAwaitingReplay) {
          subscribe(follow.view.chunks.length);
        }
        return;
      }
      isAwaitingReplay = false;
      update(view);
    });
    subscribe(follow.view.chunks.length);

    follow.stop = () => {
      isActive = false;
      stopListening();
      void api.unsubscribeStream(streamId).catch(() => undefined);
    };
    return follow;
  };

  return {
    follow(streamId, consumer) {
      let follow = follows.get(streamId);
      if (follow === undefined) {
        follow = start(streamId);
        follows.set(streamId, follow);
      }
      const current = follow;
      current.consumers.add(consumer);
      consumer(current.view);
      return () => {
        current.consumers.delete(consumer);
        if (current.consumers.size === 0 && follows.get(streamId) === current) {
          follows.delete(streamId);
          current.stop();
        }
      };
    },
  };
}

let windowFollowers: { api: StreamsApi; followers: StreamFollowers } | undefined;

/** The followers for this window's bridge, created on first use. */
function followersFor(api: StreamsApi): StreamFollowers {
  if (windowFollowers?.api !== api) {
    windowFollowers = { api, followers: createStreamFollowers(api) };
  }
  return windowFollowers.followers;
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
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    setCancelError(null);
    if (streamId === null) {
      setView(EMPTY_STREAM_VIEW);
      return undefined;
    }
    const api = getBridge();
    if (api === undefined) {
      setView({ ...EMPTY_STREAM_VIEW, error: BRIDGE_UNAVAILABLE_ERROR });
      return undefined;
    }
    return followersFor(api).follow(streamId, setView);
  }, [streamId]);

  const cancel = useCallback(async () => {
    const api = getBridge();
    if (streamId === null || api === undefined) {
      return;
    }
    const result = await api.cancelStream(streamId);
    setCancelError(result.ok ? null : result.error);
  }, [streamId]);

  return {
    text: view.chunks.join(''),
    chunkCount: view.chunks.length,
    status: view.status,
    error: view.error ?? cancelError,
    cancel,
  };
}
