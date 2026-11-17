import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { AppStateStore } from '../electron/appStateStore';
import { createStorageHandler } from '../electron/storage/handler';
import { WINDOW_SETTING_KEYS } from '../electron/storage/protocol';
import { startPersistence, type StorageSink } from '../electron/storage/writer';
import { parseWindowBounds, placeWindow, serializeWindowBounds } from '../electron/windowBounds';

/** Phase 3c: window sizes, and positions where the platform allows. */

const LIMITS = { width: 1440, height: 900, minWidth: 1024, minHeight: 640 };
const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };

describe('saving and reading window bounds', () => {
  it('round-trips size, position and maximised state', () => {
    const text = serializeWindowBounds({ x: 100, y: 50, width: 1200, height: 800 }, true, true);
    expect(parseWindowBounds(text)).toEqual({ x: 100, y: 50, width: 1200, height: 800, isMaximized: true });
  });

  it('leaves the position out where it cannot be known (Wayland)', () => {
    const text = serializeWindowBounds({ x: 0, y: 0, width: 1200, height: 800 }, false, false);
    expect(parseWindowBounds(text)).toEqual({ width: 1200, height: 800, isMaximized: false });
  });

  it.each([
    undefined,
    'not json',
    'null',
    '{"width":1200,"height":800}',
    '{"width":-5,"height":800,"isMaximized":false}',
    '{"width":1.5,"height":800,"isMaximized":false}',
    '{"width":999999,"height":800,"isMaximized":false}',
  ])('ignores the damaged value %j', (text) => {
    expect(parseWindowBounds(text)).toBeNull();
  });
});

describe('placeWindow', () => {
  it('uses the default size when nothing was saved', () => {
    expect(placeWindow(LIMITS, null, [SCREEN])).toEqual({ width: 1440, height: 900, isMaximized: false });
  });

  it('restores the saved size and position', () => {
    const saved = { x: 200, y: 100, width: 1100, height: 700, isMaximized: false };
    expect(placeWindow(LIMITS, saved, [SCREEN])).toEqual(saved);
  });

  it('keeps the size within the minimum and the largest screen', () => {
    expect(placeWindow(LIMITS, { width: 300, height: 5000, isMaximized: false }, [SCREEN])).toEqual({
      width: 1024,
      height: 1080,
      isMaximized: false,
    });
  });

  it('drops a position that would be off every screen, keeping the size', () => {
    const saved = { x: 5000, y: 100, width: 1100, height: 700, isMaximized: true };
    expect(placeWindow(LIMITS, saved, [SCREEN])).toEqual({ width: 1100, height: 700, isMaximized: true });
  });

  it('keeps a position on a second screen', () => {
    const second = { x: 1920, y: 0, width: 2560, height: 1440 };
    const saved = { x: 2100, y: 200, width: 1600, height: 1000, isMaximized: false };
    expect(placeWindow(LIMITS, saved, [SCREEN, second])).toEqual(saved);
  });
});

describe('saving window bounds through the one writer', () => {
  it('sends the setting as a write, and the worker accepts it', async () => {
    const requests: unknown[] = [];
    const sink: StorageSink = {
      request: ((request: unknown) => {
        requests.push(request);
        return Promise.resolve({ ok: true, value: null });
      }) as StorageSink['request'],
      close: vi.fn(() => Promise.resolve()),
    };
    const store = new AppStateStore();
    const persistence = startPersistence(store, sink, store.getSnapshot().state, () => undefined);
    const bounds = serializeWindowBounds({ x: 1, y: 2, width: 1100, height: 700 }, false, true);

    persistence.saveSetting(WINDOW_SETTING_KEYS.ide, bounds);

    const write = { type: 'write', ops: [{ kind: 'saveSetting', key: 'ideWindow', value: bounds }] };
    expect(requests).toEqual([write]);

    const handle = createStorageHandler(() => new DatabaseSync(':memory:'));
    handle({ type: 'open', filePath: ':memory:' });
    expect(handle(write)).toEqual({ ok: true, value: null });
    expect(handle({ type: 'load' })).toMatchObject({ ok: true, value: { settings: { ideWindow: bounds } } });
  });
});
