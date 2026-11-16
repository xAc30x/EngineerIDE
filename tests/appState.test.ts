import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialSharedState,
  DEFAULT_THREAD_TITLE,
  findThread,
  parseAction,
  PINNED_SECTION_ID,
  type ReplyOutcome,
  type SharedAction,
  type SharedState,
} from '../shared/appState';
import type { Thread } from '../shared/types';

let state: SharedState;

beforeEach(() => {
  state = createInitialSharedState();
});

function run(action: SharedAction): void {
  state = applyAction(state, action);
}

/** Creates (or reuses) a thread and returns the id of the selected thread. */
function createThread(sectionId?: string): string {
  run(sectionId === undefined ? { type: 'createThread' } : { type: 'createThread', sectionId });
  if (state.activeThreadId === null) {
    throw new Error('Expected createThread to select a thread.');
  }
  return state.activeThreadId;
}

/** Sends a message to the active thread, as a window showing that thread would. */
function send(content: string): void {
  run({ type: 'sendMessage', threadId: state.activeThreadId, content });
}

function activeThread(): Thread | undefined {
  return state.activeThreadId === null ? undefined : findThread(state, state.activeThreadId);
}

function customSectionId(): string {
  const section = state.sections.find((candidate) => candidate.kind === 'custom');
  if (section === undefined) {
    throw new Error('Expected at least one custom section in the initial state.');
  }
  return section.id;
}

describe('initial state', () => {
  it('starts with no thread, no project, and the CLI backend', () => {
    expect(state.activeThreadId).toBeNull();
    expect(state.activeProjectPath).toBeNull();
    expect(state.selectedBackend).toBe('claude-cli');
    expect(state.recents).toEqual([]);
  });

  it('has the Pinned section first, followed by custom sections', () => {
    const [first, ...rest] = state.sections;
    expect(first).toMatchObject({ id: PINNED_SECTION_ID, title: 'Pinned', kind: 'pinned' });
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((section) => section.kind === 'custom')).toBe(true);
  });
});

describe('threads', () => {
  it('creates a thread in Recents and selects it', () => {
    const threadId = createThread();
    expect(state.recents.map((thread) => thread.id)).toEqual([threadId]);
    expect(state.activeThreadId).toBe(threadId);
  });

  it('reuses an empty thread instead of adding another', () => {
    const first = createThread();
    const second = createThread();
    expect(second).toBe(first);
    expect(state.recents).toHaveLength(1);
  });

  it('adds a new thread once the latest one has messages', () => {
    const first = createThread();
    send('Hello');
    const second = createThread();
    expect(second).not.toBe(first);
    expect(state.recents.map((thread) => thread.id)).toEqual([second, first]);
  });

  it('creates a thread inside a section and expands that section', () => {
    const sectionId = customSectionId();
    run({ type: 'toggleSectionCollapsed', sectionId });
    const threadId = createThread(sectionId);
    const section = state.sections.find((candidate) => candidate.id === sectionId);
    expect(section?.items.map((thread) => thread.id)).toEqual([threadId]);
    expect(section?.isCollapsed).toBe(false);
    expect(state.recents).toEqual([]);
  });

  it('ignores selection of an unknown thread', () => {
    const threadId = createThread();
    run({ type: 'selectThread', threadId: 'does-not-exist' });
    expect(state.activeThreadId).toBe(threadId);
  });

  it('selects an existing thread', () => {
    const first = createThread();
    send('Hello');
    const second = createThread();
    run({ type: 'selectThread', threadId: first });
    expect(state.activeThreadId).toBe(first);
    expect(findThread(state, second)).toBeDefined();
  });
});

describe('sendMessage', () => {
  it('creates a thread when none is active and titles it from the first message', () => {
    send('  Plan the release\nwith details  ');
    const thread = activeThread();
    expect(thread?.title).toBe('Plan the release');
    expect(thread?.messages[0]).toMatchObject({
      role: 'user',
      content: 'Plan the release\nwith details',
    });
  });

  it('adds only the user message; the reply is started by the main process', () => {
    send('Hello');
    const thread = activeThread();
    expect(thread?.messages.map((message) => message.role)).toEqual(['user']);
    expect(thread?.runningReply).toBeNull();
  });

  it('ignores blank messages', () => {
    send('   \n ');
    expect(state.activeThreadId).toBeNull();
    expect(state.recents).toEqual([]);
  });

  it('keeps the title after the first message and shortens long titles', () => {
    send('x'.repeat(200));
    const title = activeThread()?.title ?? '';
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.endsWith('…')).toBe(true);
    send('Second message');
    expect(activeThread()?.title).toBe(title);
  });

  it('appends to a thread that lives inside a section', () => {
    const sectionId = customSectionId();
    const threadId = createThread(sectionId);
    send('Inside a section');
    const thread = findThread(state, threadId);
    expect(thread?.messages[0]?.content).toBe('Inside a section');
    expect(thread?.title).not.toBe(DEFAULT_THREAD_TITLE);
  });

  it('adds the message to the named thread without changing the selection', () => {
    const first = createThread();
    send('First thread');
    const second = createThread();
    run({ type: 'sendMessage', threadId: first, content: 'Sent from the other window' });
    expect(findThread(state, first)?.messages.map((message) => message.content)).toContain(
      'Sent from the other window',
    );
    expect(findThread(state, second)?.messages).toEqual([]);
    expect(state.activeThreadId).toBe(second);
  });

  it('creates and selects a thread when the named thread does not exist', () => {
    run({ type: 'sendMessage', threadId: 'does-not-exist', content: 'Hello' });
    expect(activeThread()?.messages[0]?.content).toBe('Hello');
  });
});

describe('sections', () => {
  it('adds a section with a trimmed title and rejects blank titles', () => {
    const before = state.sections.length;
    run({ type: 'addSection', title: '  Research  ' });
    expect(state.sections).toHaveLength(before + 1);
    expect(state.sections.at(-1)).toMatchObject({ title: 'Research', kind: 'custom', items: [] });
    run({ type: 'addSection', title: '   ' });
    expect(state.sections).toHaveLength(before + 1);
  });

  it('toggles the collapsed state of one section only', () => {
    const sectionId = customSectionId();
    run({ type: 'toggleSectionCollapsed', sectionId });
    const collapsed = state.sections.filter((section) => section.isCollapsed);
    expect(collapsed.map((section) => section.id)).toEqual([sectionId]);
  });

  it('moves threads to Recents when their section is removed', () => {
    const sectionId = customSectionId();
    const threadId = createThread(sectionId);
    run({ type: 'removeSection', sectionId });
    expect(state.sections.some((section) => section.id === sectionId)).toBe(false);
    expect(state.recents.map((thread) => thread.id)).toEqual([threadId]);
    expect(state.activeThreadId).toBe(threadId);
  });

  it('does not remove the Pinned section', () => {
    run({ type: 'removeSection', sectionId: PINNED_SECTION_ID });
    expect(state.sections[0]?.id).toBe(PINNED_SECTION_ID);
  });

  it('pins and unpins a thread without duplicating it', () => {
    const threadId = createThread();
    run({ type: 'togglePinned', threadId });
    expect(state.sections[0]?.items.map((thread) => thread.id)).toEqual([threadId]);
    expect(state.recents).toEqual([]);
    run({ type: 'togglePinned', threadId });
    expect(state.sections[0]?.items).toEqual([]);
    expect(state.recents.map((thread) => thread.id)).toEqual([threadId]);
  });

  it('leaves the state unchanged when moving to an unknown section', () => {
    const threadId = createThread();
    run({ type: 'moveThread', threadId, sectionId: 'does-not-exist' });
    expect(state.recents.map((thread) => thread.id)).toEqual([threadId]);
  });
});

describe('project and backend', () => {
  it('stores and clears the active project folder', () => {
    run({ type: 'setActiveProject', folder: { path: 'project-path', name: 'project' } });
    expect(state.activeProjectPath).toBe('project-path');
    expect(state.activeProjectName).toBe('project');
    run({ type: 'setActiveProject', folder: null });
    expect(state.activeProjectPath).toBeNull();
    expect(state.activeProjectName).toBeNull();
  });
});

describe('applyAction', () => {
  it('returns the same object when an action changes nothing', () => {
    const before = state;
    run({ type: 'selectThread', threadId: 'does-not-exist' });
    run({ type: 'sendMessage', threadId: null, content: '  ' });
    run({ type: 'addSection', title: '' });
    run({ type: 'removeSection', sectionId: PINNED_SECTION_ID });
    run({ type: 'toggleSectionCollapsed', sectionId: 'does-not-exist' });
    run({ type: 'setSelectedBackend', backend: state.selectedBackend });
    expect(state).toBe(before);
  });

  it('does not modify the state it was given', () => {
    const before = state;
    const copy = structuredClone(before);
    createThread();
    send('Hello');
    run({ type: 'addSection', title: 'Research' });
    expect(state).not.toBe(before);
    expect(before).toEqual(copy);
  });
});

describe('startReply and finishReply', () => {
  function startedThread(streamId = 's1'): string {
    send('Hello');
    const threadId = state.activeThreadId as string;
    run({ type: 'startReply', threadId, streamId, provider: 'claude-cli' });
    return threadId;
  }

  it('records the running reply on the thread', () => {
    const threadId = startedThread();
    expect(findThread(state, threadId)?.runningReply).toEqual({ streamId: 's1', provider: 'claude-cli' });
  });

  it('ignores a second start while a reply is running', () => {
    const threadId = startedThread('s1');
    const before = state;
    run({ type: 'startReply', threadId, streamId: 's2', provider: 'openrouter' });
    expect(state).toBe(before);
  });

  it('ignores a start for an unknown thread', () => {
    const before = state;
    run({ type: 'startReply', threadId: 'nope', streamId: 's1', provider: 'claude-cli' });
    expect(state).toBe(before);
  });

  it('clears the running reply when it finishes', () => {
    const threadId = startedThread();
    run({ type: 'finishReply', threadId, streamId: 's1', outcome: { status: 'completed', text: 'Hi' } });
    expect(findThread(state, threadId)?.runningReply).toBeNull();
  });

  function finish(outcome: ReplyOutcome): Thread | undefined {
    const threadId = startedThread();
    run({ type: 'finishReply', threadId, streamId: 's1', outcome });
    return findThread(state, threadId);
  }

  function addedMessages(thread: Thread | undefined): Array<[string, string]> {
    return (thread?.messages ?? []).slice(1).map((message) => [message.role, message.content]);
  }

  it('stores a completed reply as an assistant message', () => {
    expect(addedMessages(finish({ status: 'completed', text: 'Hi there' }))).toEqual([
      ['assistant', 'Hi there'],
    ]);
  });

  it('adds nothing for a completed reply with no text', () => {
    expect(addedMessages(finish({ status: 'completed', text: '  ' }))).toEqual([]);
  });

  it('keeps the partial text of a stopped reply and notes that it was stopped', () => {
    expect(addedMessages(finish({ status: 'cancelled', text: 'Half a' }))).toEqual([
      ['assistant', 'Half a'],
      ['system', 'Reply stopped.'],
    ]);
  });

  it('notes a stopped reply that had produced no text', () => {
    expect(addedMessages(finish({ status: 'cancelled', text: '' }))).toEqual([
      ['system', 'Reply stopped.'],
    ]);
  });

  it('keeps the partial text of a failed reply and shows the error', () => {
    expect(
      addedMessages(finish({ status: 'failed', text: 'Some', error: 'Quota used up' })),
    ).toEqual([
      ['assistant', 'Some'],
      ['system', 'The reply failed: Quota used up'],
    ]);
  });

  it('shows a fallback when a failure has no error text', () => {
    expect(addedMessages(finish({ status: 'failed', text: '' }))).toEqual([
      ['system', 'The reply failed: unknown error'],
    ]);
  });

  it('ignores a finish for a stream that is not the running reply', () => {
    const threadId = startedThread('s1');
    const before = state;
    run({ type: 'finishReply', threadId, streamId: 'stale', outcome: { status: 'completed', text: 'Old' } });
    expect(state).toBe(before);
  });
});

describe('parseAction', () => {
  it('accepts every action a window may send', () => {
    const actions: SharedAction[] = [
      { type: 'createThread' },
      { type: 'createThread', sectionId: 's1' },
      { type: 'selectThread', threadId: 't1' },
      { type: 'sendMessage', threadId: 't1', content: 'Hello' },
      { type: 'sendMessage', threadId: null, content: 'Hello' },
      { type: 'moveThread', threadId: 't1', sectionId: 's1' },
      { type: 'moveThread', threadId: 't1', sectionId: null },
      { type: 'togglePinned', threadId: 't1' },
      { type: 'addSection', title: 'Research' },
      { type: 'removeSection', sectionId: 's1' },
      { type: 'toggleSectionCollapsed', sectionId: 's1' },
      { type: 'setSelectedBackend', backend: 'openrouter' },
    ];
    for (const action of actions) {
      expect(parseAction(action)).toEqual(action);
    }
  });

  it('keeps only the expected fields', () => {
    expect(parseAction({ type: 'selectThread', threadId: 't1', extra: 'ignored' })).toEqual({
      type: 'selectThread',
      threadId: 't1',
    });
  });

  it('rejects payloads that are not actions', () => {
    const invalid: unknown[] = [
      undefined,
      null,
      'createThread',
      42,
      [],
      {},
      { type: 'unknown' },
      { type: 'createThread', sectionId: 7 },
      { type: 'selectThread' },
      { type: 'selectThread', threadId: null },
      { type: 'sendMessage', threadId: 't1' },
      { type: 'sendMessage', threadId: 7, content: 'Hello' },
      { type: 'sendMessage', threadId: 't1', content: { text: 'Hello' } },
      { type: 'moveThread', threadId: 't1' },
      { type: 'togglePinned', threadId: ['t1'] },
      { type: 'addSection' },
      { type: 'removeSection', sectionId: null },
      { type: 'toggleSectionCollapsed' },
      { type: 'setSelectedBackend', backend: 'not-a-backend' },
    ];
    for (const payload of invalid) {
      expect(parseAction(payload)).toBeNull();
    }
  });

  it('rejects startReply and finishReply, which only the main process may dispatch', () => {
    expect(
      parseAction({ type: 'startReply', threadId: 't1', streamId: 's1', provider: 'claude-cli' }),
    ).toBeNull();
    expect(
      parseAction({
        type: 'finishReply',
        threadId: 't1',
        streamId: 's1',
        outcome: { status: 'completed', text: 'Hi' },
      }),
    ).toBeNull();
  });

  it('rejects setActiveProject, which only the main process may dispatch', () => {
    expect(
      parseAction({ type: 'setActiveProject', folder: { path: 'anywhere', name: 'anywhere' } }),
    ).toBeNull();
  });
});
