import { app, type WebContents } from 'electron';
import { STREAM_CHANNELS, type StreamDelta } from '../../shared/ipc/streams';
import { parseKnownChunks, parseStreamId } from '../streams/requests';
import { StreamHub } from '../streams/streamHub';
import { parseTestStreamOptions, startTestStream } from '../streams/testStream';
import type { WindowRegistry } from '../windows';
import { handleFromAppWindow } from './handle';

interface StreamsIpcDependencies {
  windows: WindowRegistry;
}

const UNKNOWN_STREAM_ERROR = 'That stream does not exist or has been released.';
const INVALID_STREAM_ID_ERROR = 'Request rejected: the stream id is not valid.';

/**
 * Registers the `stream:*` handlers and returns the stream hub, which later
 * phases use to create streams. Each window is a subscriber keyed by its
 * `webContents` id, so a reloaded window that subscribes again replaces its
 * old subscription instead of receiving everything twice.
 */
export function registerStreamsIpc({ windows }: StreamsIpcDependencies): StreamHub {
  const hub = new StreamHub();
  const trackedSenders = new Set<number>();

  /** Forgets a window's subscriptions when its page is destroyed. */
  const track = (sender: WebContents): void => {
    if (trackedSenders.has(sender.id)) {
      return;
    }
    trackedSenders.add(sender.id);
    const senderId = sender.id;
    sender.once('destroyed', () => {
      trackedSenders.delete(senderId);
      hub.removeSubscriber(senderId);
    });
  };

  const sinkFor =
    (sender: WebContents) =>
    (delta: StreamDelta): boolean => {
      if (sender.isDestroyed()) {
        return false;
      }
      sender.send(STREAM_CHANNELS.data, delta);
      return true;
    };

  handleFromAppWindow<null>(STREAM_CHANNELS.subscribe, windows, (event, streamIdValue, known) => {
    const streamId = parseStreamId(streamIdValue);
    const knownChunks = parseKnownChunks(known);
    if (streamId === null || knownChunks === null) {
      return { ok: false, error: 'Request rejected: it is not a valid stream subscription.' };
    }
    track(event.sender);
    if (!hub.subscribe(streamId, event.sender.id, knownChunks, sinkFor(event.sender))) {
      return { ok: false, error: UNKNOWN_STREAM_ERROR };
    }
    return { ok: true, value: null };
  });

  handleFromAppWindow<null>(STREAM_CHANNELS.unsubscribe, windows, (event, streamIdValue) => {
    const streamId = parseStreamId(streamIdValue);
    if (streamId === null) {
      return { ok: false, error: INVALID_STREAM_ID_ERROR };
    }
    hub.unsubscribe(streamId, event.sender.id);
    return { ok: true, value: null };
  });

  // Any window may cancel any stream: streams belong to main, not to the window that started them.
  handleFromAppWindow<null>(STREAM_CHANNELS.cancel, windows, (_event, streamIdValue) => {
    const streamId = parseStreamId(streamIdValue);
    if (streamId === null) {
      return { ok: false, error: INVALID_STREAM_ID_ERROR };
    }
    return hub.cancel(streamId)
      ? { ok: true, value: null }
      : { ok: false, error: UNKNOWN_STREAM_ERROR };
  });

  // Development aid: a fake producer, so the channel can be watched without an AI backend.
  handleFromAppWindow<string>(STREAM_CHANNELS.startTest, windows, (_event, optionsValue) => {
    if (app.isPackaged) {
      return { ok: false, error: 'Test streams are only available in development builds.' };
    }
    const options = parseTestStreamOptions(optionsValue);
    if (options === null) {
      return { ok: false, error: 'Request rejected: the test stream options are not valid.' };
    }
    return { ok: true, value: startTestStream(hub, options) };
  });

  // Stop producers and the flush timer before windows are torn down.
  app.on('will-quit', () => hub.dispose());

  return hub;
}
