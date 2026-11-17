import { describe, expect, it, vi } from 'vitest';
import {
  COMMAND_CATEGORIES,
  COMMAND_REGISTRY,
  WINDOW_KINDS,
  commandsForWindow,
  cycleIndex,
  filterCommands,
  type CommandHelpers,
} from '../src/config/commands';
import type { WindowKind } from '../src/types';

function fakeHelpers(windowKind: WindowKind = 'workspace'): CommandHelpers {
  return {
    windowKind,
    showWindow: vi.fn(),
    selectFolder: vi.fn(async () => {}),
    createThread: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleArtifactsPanel: vi.fn(),
    setActiveNavTab: vi.fn(),
    setSelectedBackend: vi.fn(),
    closePalette: vi.fn(),
  };
}

function ids(windowKind: WindowKind, isDesktop: boolean): string[] {
  return commandsForWindow(COMMAND_REGISTRY, windowKind, isDesktop).map((command) => command.id);
}

function byId(id: string) {
  const command = COMMAND_REGISTRY.find((item) => item.id === id);
  if (command === undefined) {
    throw new Error(`No command ${id}`);
  }
  return command;
}

describe('COMMAND_REGISTRY', () => {
  it('has unique ids', () => {
    const all = COMMAND_REGISTRY.map((command) => command.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('uses only known window kinds and categories', () => {
    for (const command of COMMAND_REGISTRY) {
      expect(COMMAND_CATEGORIES).toContain(command.category);
      for (const kind of command.windows ?? []) {
        expect(WINDOW_KINDS).toContain(kind);
      }
      // An empty list would hide the command everywhere; leave `windows` out instead.
      expect(command.windows?.length).not.toBe(0);
    }
  });

  it('has one model command per backend, each naming its backend', () => {
    const models = COMMAND_REGISTRY.filter((command) => command.backend !== undefined);
    expect(models.map((command) => command.id)).toEqual([
      'ai-select-claude-cli',
      'ai-select-openrouter',
      'ai-select-anthropic-api',
      'ai-select-openai-api',
    ]);
  });

  it('runs each command through its helper and closes the palette', async () => {
    const helpers = fakeHelpers();
    for (const command of COMMAND_REGISTRY) {
      await command.action(helpers);
    }
    expect(helpers.setActiveNavTab).toHaveBeenCalledWith('settings');
    expect(helpers.createThread).toHaveBeenCalledTimes(1);
    expect(helpers.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(helpers.toggleArtifactsPanel).toHaveBeenCalledTimes(1);
    expect(helpers.setSelectedBackend).toHaveBeenCalledWith('anthropic-api');
    expect(helpers.selectFolder).toHaveBeenCalledTimes(1);
    expect(helpers.closePalette).toHaveBeenCalledTimes(COMMAND_REGISTRY.length);
  });

  it('opens the other window from either window', async () => {
    const fromWorkspace = fakeHelpers('workspace');
    const fromIde = fakeHelpers('ide');
    await byId('nav-toggle-window').action(fromWorkspace);
    await byId('nav-toggle-window').action(fromIde);
    expect(fromWorkspace.showWindow).toHaveBeenCalledWith('ide');
    expect(fromIde.showWindow).toHaveBeenCalledWith('workspace');
  });

  it('closes the palette before the folder dialog opens', async () => {
    const order: string[] = [];
    const helpers = {
      ...fakeHelpers(),
      closePalette: () => order.push('close'),
      selectFolder: async () => {
        order.push('dialog');
      },
    };
    await byId('project-open-folder').action(helpers);
    expect(order).toEqual(['close', 'dialog']);
  });

  it('shows Ctrl shortcuts when no desktop bridge reports macOS', () => {
    expect(byId('layout-toggle-sidebar').shortcut).toBe('Ctrl+B');
  });
});

describe('commandsForWindow', () => {
  it('offers everything in the Workspace window of the desktop app', () => {
    expect(ids('workspace', true)).toEqual(COMMAND_REGISTRY.map((command) => command.id));
  });

  it('leaves out Workspace-only commands in the IDE window', () => {
    expect(ids('ide', true)).toEqual([
      'nav-toggle-window',
      'ai-select-claude-cli',
      'ai-select-openrouter',
      'ai-select-anthropic-api',
      'ai-select-openai-api',
      'project-open-folder',
    ]);
  });

  it('leaves out desktop-only commands outside the desktop app', () => {
    const offered = ids('workspace', false);
    expect(offered).not.toContain('nav-toggle-window');
    expect(offered).not.toContain('project-open-folder');
    expect(offered).toContain('ai-select-openrouter');
    expect(offered).toContain('layout-toggle-sidebar');
  });
});

describe('filterCommands', () => {
  const commands = commandsForWindow(COMMAND_REGISTRY, 'workspace', true);
  const titles = (query: string) => filterCommands(commands, query).map((command) => command.title);

  it('returns every command, in order, for an empty or blank query', () => {
    expect(filterCommands(commands, '')).toEqual(commands);
    expect(filterCommands(commands, '   ')).toEqual(commands);
  });

  it('matches case-insensitively on the title, category and keywords', () => {
    expect(titles('SETTINGS')).toEqual(['Go to Settings View']);
    expect(titles('layout')).toEqual(['Toggle Sidebar', 'Toggle Artifacts Split Pane']);
    expect(titles('backend')).toEqual([
      'Switch AI Backend to Claude Sub (CLI)',
      'Switch AI Backend to OpenRouter',
      'Switch AI Backend to Anthropic API',
      'Switch AI Backend to OpenAI API',
    ]);
  });

  it('needs every word of the query to match', () => {
    expect(titles('switch open')).toEqual(['Switch AI Backend to OpenRouter', 'Switch AI Backend to OpenAI API']);
    expect(titles('go nothing-like-this')).toEqual([]);
  });

  it('puts titles that start with the query first', () => {
    expect(titles('open')[0]).toBe('Open Project Folder…');
    expect(titles('open')).toContain('Switch AI Backend to OpenRouter');
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
