import { describe, expect, it } from 'vitest';
import { readThreadMessages } from '../electron/threadMessages';
import { THREADS_ERRORS } from '../shared/ipc/threads';
import {
  applyAction,
  createInitialSharedState,
  findThread,
  toIndexState,
  type SharedState,
} from '../shared/appState';

/** Phase 3c: windows get a thread index; messages are fetched per thread. */

function stateWithTwoMessages(): { state: SharedState; threadId: string } {
  let state = applyAction(createInitialSharedState(), {
    type: 'sendMessage',
    threadId: null,
    content: 'Title line',
  });
  const threadId = state.activeThreadId ?? '';
  state = applyAction(state, { type: 'togglePinned', threadId });
  state = applyAction(state, { type: 'sendMessage', threadId, content: 'second message body' });
  return { state, threadId };
}

describe('toIndexState', () => {
  it('drops every message body and keeps the count', () => {
    const { state, threadId } = stateWithTwoMessages();
    state.recents.push({ ...state.sections[0]!.items[0]!, id: 'other' });

    const index = toIndexState(state);

    // The title comes from the first message, so look for the second one.
    expect(JSON.stringify(index)).not.toContain('second message body');
    expect(findThread(index, threadId)).toMatchObject({ messageCount: 2, title: 'Title line' });
    expect(findThread(index, threadId)).not.toHaveProperty('messages');
    expect(findThread(index, 'other')).not.toHaveProperty('messages');
  });

  it('keeps everything else as it is', () => {
    const { state } = stateWithTwoMessages();
    const index = toIndexState(state);

    expect(index.activeThreadId).toBe(state.activeThreadId);
    expect(index.selectedBackend).toBe(state.selectedBackend);
    expect(index.sections.map((section) => [section.id, section.items.length])).toEqual(
      state.sections.map((section) => [section.id, section.items.length]),
    );
  });
});

describe('readThreadMessages', () => {
  it("returns a thread's messages in order", () => {
    const { state, threadId } = stateWithTwoMessages();
    const result = readThreadMessages(state, threadId);

    expect(result.ok && result.value.map((message) => message.content)).toEqual([
      'Title line',
      'second message body',
    ]);
  });

  it.each([undefined, 7, '', 'x'.repeat(201), { id: 'x' }])('rejects %j', (threadId) => {
    expect(readThreadMessages(createInitialSharedState(), threadId)).toEqual({
      ok: false,
      error: THREADS_ERRORS.invalidRequest,
    });
  });

  it('reports a thread that does not exist', () => {
    expect(readThreadMessages(createInitialSharedState(), 'missing')).toEqual({
      ok: false,
      error: THREADS_ERRORS.unknownThread,
    });
  });
});
