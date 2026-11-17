import { describe, expect, it, vi } from 'vitest';
import {
  buildCommands,
  cycleIndex,
  filterCommands,
  type CommandContext,
  type CommandHelpers,
} from '../src/config/commands';

function fakeHelpers(): CommandHelpers {
  return {
    showWindow: vi.fn(),
    selectFolder: vi.fn(async () => {}),
    setActiveNavTab: vi.fn(),
    createThread: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleArtifactsPanel: vi.fn(),
    setSelectedBackend: vi.fn(),
  };
}

const WORKSPACE: CommandContext = {
  windowKind: 'workspace',
  isDesktop: true,
  selectedBackend: 'claude-cli',
  isSidebarCollapsed: false,
  isArtifactsPanelOpen: false,
};

function ids(context: CommandContext): string[] {
  return buildCommands(fakeHelpers(), context).map((command) => command.id);
}

describe('buildCommands', () => {
  it('offers pages, chat, view, window, model and folder commands in the Workspace window', () => {
    expect(ids(WORKSPACE)).toEqual([
      'chat.new',
      'nav.chat',
      'nav.projects',
      'nav.artifacts',
      'nav.scheduled',
      'nav.design',
      'nav.settings',
      'view.sidebar',
      'view.artifacts',
      'window.ide',
      'model.claude-cli',
      'model.openrouter',
      'model.anthropic-api',
      'model.openai-api',
      'project.openFolder',
    ]);
  });

  it('leaves out the sidebar, pages and new chat in the IDE window', () => {
    expect(ids({ ...WORKSPACE, windowKind: 'ide' })).toEqual([
      'window.workspace',
      'model.claude-cli',
      'model.openrouter',
      'model.anthropic-api',
      'model.openai-api',
      'project.openFolder',
    ]);
  });

  it('leaves out window and folder commands outside the desktop app', () => {
    const offered = ids({ ...WORKSPACE, isDesktop: false });
    expect(offered).not.toContain('window.ide');
    expect(offered).not.toContain('project.openFolder');
    expect(offered).toContain('model.openrouter');
  });

  it('marks the selected model and names toggles by what they will do', () => {
    const commands = buildCommands(fakeHelpers(), {
      ...WORKSPACE,
      selectedBackend: 'openrouter',
      isSidebarCollapsed: true,
      isArtifactsPanelOpen: true,
    });
    const current = commands.filter((command) => command.isCurrent === true).map((command) => command.id);
    expect(current).toEqual(['model.openrouter']);
    expect(commands.find((command) => command.id === 'view.sidebar')?.title).toBe('Show sidebar');
    expect(commands.find((command) => command.id === 'view.artifacts')?.title).toBe('Hide artifacts panel');
  });

  it('runs each command through its helper', async () => {
    const helpers = fakeHelpers();
    const byId = new Map(buildCommands(helpers, WORKSPACE).map((command) => [command.id, command]));

    await byId.get('nav.settings')?.run();
    await byId.get('chat.new')?.run();
    await byId.get('view.sidebar')?.run();
    await byId.get('view.artifacts')?.run();
    await byId.get('window.ide')?.run();
    await byId.get('model.anthropic-api')?.run();
    await byId.get('project.openFolder')?.run();

    expect(helpers.setActiveNavTab).toHaveBeenCalledWith('settings');
    expect(helpers.createThread).toHaveBeenCalledTimes(1);
    expect(helpers.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(helpers.toggleArtifactsPanel).toHaveBeenCalledTimes(1);
    expect(helpers.showWindow).toHaveBeenCalledWith('ide');
    expect(helpers.setSelectedBackend).toHaveBeenCalledWith('anthropic-api');
    expect(helpers.selectFolder).toHaveBeenCalledTimes(1);
  });

  it('shows Ctrl shortcuts when no desktop bridge reports macOS', () => {
    const sidebar = buildCommands(fakeHelpers(), WORKSPACE).find((command) => command.id === 'view.sidebar');
    expect(sidebar?.shortcut).toBe('Ctrl+B');
  });
});

describe('filterCommands', () => {
  const commands = buildCommands(fakeHelpers(), WORKSPACE);
  const titles = (query: string) => filterCommands(commands, query).map((command) => command.title);

  it('returns every command, in order, for an empty or blank query', () => {
    expect(filterCommands(commands, '')).toEqual(commands);
    expect(filterCommands(commands, '   ')).toEqual(commands);
  });

  it('matches case-insensitively on the title, group and keywords', () => {
    expect(titles('SETTINGS')).toEqual(['Go to Settings']);
    expect(titles('backend')).toEqual([
      'Use Claude Sub (CLI)',
      'Use OpenRouter',
      'Use Anthropic API',
      'Use OpenAI API',
    ]);
  });

  it('needs every word of the query to match', () => {
    expect(titles('use open')).toEqual(['Use OpenRouter', 'Use OpenAI API']);
    expect(titles('go nothing-like-this')).toEqual([]);
  });

  it('puts titles that start with the query first', () => {
    expect(titles('open')[0]).toBe('Open the IDE window');
    expect(titles('open')).toContain('Use OpenRouter');
  });
});

describe('cycleIndex', () => {
  it('moves down and up, wrapping at both ends', () => {
    expect(cycleIndex(0, 1, 3)).toBe(1);
    expect(cycleIndex(2, 1, 3)).toBe(0);
    expect(cycleIndex(0, -1, 3)).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(cycleIndex(0, 1, 0)).toBe(0);
    expect(cycleIndex(5, -1, 0)).toBe(0);
  });
});
