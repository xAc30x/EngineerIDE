import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInitialState,
  DEFAULT_THREAD_TITLE,
  findThread,
  PINNED_SECTION_ID,
  selectActiveThread,
  useAppStore,
} from '../src/store/useAppStore';

const store = () => useAppStore.getState();

function customSectionId(): string {
  const section = store().sections.find((candidate) => candidate.kind === 'custom');
  if (section === undefined) {
    throw new Error('Expected at least one custom section in the initial state.');
  }
  return section.id;
}

beforeEach(() => {
  useAppStore.setState(createInitialState());
});

describe('initial state', () => {
  it('starts in workspace mode with no thread, no project, and the CLI backend', () => {
    expect(store().activeMode).toBe('workspace');
    expect(store().activeNavTab).toBe('chat');
    expect(store().activeThreadId).toBeNull();
    expect(store().activeProjectPath).toBeNull();
    expect(store().selectedBackend).toBe('claude-cli');
    expect(store().recents).toEqual([]);
  });

  it('has the Pinned section first, followed by custom sections', () => {
    const [first, ...rest] = store().sections;
    expect(first).toMatchObject({ id: PINNED_SECTION_ID, title: 'Pinned', kind: 'pinned' });
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((section) => section.kind === 'custom')).toBe(true);
  });
});

describe('mode and navigation', () => {
  it('toggles between workspace and ide', () => {
    store().toggleMode();
    expect(store().activeMode).toBe('ide');
    store().toggleMode();
    expect(store().activeMode).toBe('workspace');
  });

  it('keeps the active thread when the mode changes', () => {
    const threadId = store().createThread();
    store().sendMessage('Shared between modes');
    store().toggleMode();
    expect(store().activeThreadId).toBe(threadId);
    expect(selectActiveThread(store())?.messages[0]?.content).toBe('Shared between modes');
  });

  it('switches to workspace mode when a page tab is opened from ide mode', () => {
    store().setActiveMode('ide');
    store().setActiveNavTab('projects');
    expect(store().activeNavTab).toBe('projects');
    expect(store().activeMode).toBe('workspace');
  });

  it('stays in ide mode when the chat tab is selected', () => {
    store().setActiveMode('ide');
    store().setActiveNavTab('chat');
    expect(store().activeMode).toBe('ide');
  });
});

describe('threads', () => {
  it('creates a thread in Recents and selects it', () => {
    store().setActiveNavTab('scheduled');
    const threadId = store().createThread();
    expect(store().recents.map((thread) => thread.id)).toEqual([threadId]);
    expect(store().activeThreadId).toBe(threadId);
    expect(store().activeNavTab).toBe('chat');
  });

  it('reuses an empty thread instead of adding another', () => {
    const first = store().createThread();
    const second = store().createThread();
    expect(second).toBe(first);
    expect(store().recents).toHaveLength(1);
  });

  it('adds a new thread once the latest one has messages', () => {
    const first = store().createThread();
    store().sendMessage('Hello');
    const second = store().createThread();
    expect(second).not.toBe(first);
    expect(store().recents.map((thread) => thread.id)).toEqual([second, first]);
  });

  it('creates a thread inside a section and expands that section', () => {
    const sectionId = customSectionId();
    store().toggleSectionCollapsed(sectionId);
    const threadId = store().createThread(sectionId);
    const section = store().sections.find((candidate) => candidate.id === sectionId);
    expect(section?.items.map((thread) => thread.id)).toEqual([threadId]);
    expect(section?.isCollapsed).toBe(false);
    expect(store().recents).toEqual([]);
  });

  it('ignores selection of an unknown thread', () => {
    const threadId = store().createThread();
    store().selectThread('does-not-exist');
    expect(store().activeThreadId).toBe(threadId);
  });
});

describe('sendMessage', () => {
  it('creates a thread when none is active and titles it from the first message', () => {
    store().sendMessage('  Plan the release\nwith details  ');
    const thread = selectActiveThread(store());
    expect(thread?.title).toBe('Plan the release');
    expect(thread?.messages[0]).toMatchObject({
      role: 'user',
      content: 'Plan the release\nwith details',
    });
  });

  it('records a system notice naming the backend instead of an assistant reply', () => {
    store().setSelectedBackend('openrouter');
    store().sendMessage('Hello');
    const messages = selectActiveThread(store())?.messages ?? [];
    expect(messages.map((message) => message.role)).toEqual(['user', 'system']);
    expect(messages[1]?.content).toContain('OpenRouter');
  });

  it('ignores blank messages', () => {
    store().sendMessage('   \n ');
    expect(store().activeThreadId).toBeNull();
    expect(store().recents).toEqual([]);
  });

  it('keeps the title after the first message and shortens long titles', () => {
    store().sendMessage('x'.repeat(200));
    const title = selectActiveThread(store())?.title ?? '';
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.endsWith('…')).toBe(true);
    store().sendMessage('Second message');
    expect(selectActiveThread(store())?.title).toBe(title);
  });

  it('appends to a thread that lives inside a section', () => {
    const sectionId = customSectionId();
    const threadId = store().createThread(sectionId);
    store().sendMessage('Inside a section');
    const thread = findThread(store(), threadId);
    expect(thread?.messages[0]?.content).toBe('Inside a section');
    expect(thread?.title).not.toBe(DEFAULT_THREAD_TITLE);
  });
});

describe('sections', () => {
  it('adds a section with a trimmed title and rejects blank titles', () => {
    const before = store().sections.length;
    const sectionId = store().addSection('  Research  ');
    expect(sectionId).not.toBeNull();
    expect(store().sections.at(-1)).toMatchObject({ id: sectionId, title: 'Research', items: [] });
    expect(store().addSection('   ')).toBeNull();
    expect(store().sections).toHaveLength(before + 1);
  });

  it('toggles the collapsed state of one section only', () => {
    const sectionId = customSectionId();
    store().toggleSectionCollapsed(sectionId);
    const collapsed = store().sections.filter((section) => section.isCollapsed);
    expect(collapsed.map((section) => section.id)).toEqual([sectionId]);
  });

  it('moves threads to Recents when their section is removed', () => {
    const sectionId = customSectionId();
    const threadId = store().createThread(sectionId);
    store().removeSection(sectionId);
    expect(store().sections.some((section) => section.id === sectionId)).toBe(false);
    expect(store().recents.map((thread) => thread.id)).toEqual([threadId]);
    expect(store().activeThreadId).toBe(threadId);
  });

  it('does not remove the Pinned section', () => {
    store().removeSection(PINNED_SECTION_ID);
    expect(store().sections[0]?.id).toBe(PINNED_SECTION_ID);
  });

  it('pins and unpins a thread without duplicating it', () => {
    const threadId = store().createThread();
    store().togglePinned(threadId);
    expect(store().sections[0]?.items.map((thread) => thread.id)).toEqual([threadId]);
    expect(store().recents).toEqual([]);
    store().togglePinned(threadId);
    expect(store().sections[0]?.items).toEqual([]);
    expect(store().recents.map((thread) => thread.id)).toEqual([threadId]);
  });

  it('leaves the state unchanged when moving to an unknown section', () => {
    const threadId = store().createThread();
    store().moveThread(threadId, 'does-not-exist');
    expect(store().recents.map((thread) => thread.id)).toEqual([threadId]);
  });
});

describe('project and backend', () => {
  it('stores and clears the active project folder', () => {
    store().setActiveProject({ path: 'project-path', name: 'project' });
    expect(store().activeProjectPath).toBe('project-path');
    expect(store().activeProjectName).toBe('project');
    store().setActiveProject(null);
    expect(store().activeProjectPath).toBeNull();
    expect(store().activeProjectName).toBeNull();
  });
});
