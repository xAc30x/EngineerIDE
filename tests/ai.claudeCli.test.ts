import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AIStreamEvent } from '../electron/ai/adapter';
import {
  buildPrompt,
  buildReplyArgs,
  CLAUDE_CLI_REASONS,
  createClaudeCliProvider,
  parseStreamLine,
  type SpawnFunction,
} from '../electron/ai/providers/claudeCli';
import type { Message } from '../shared/types';

/** A stand-in child process. Nothing real is started. */
class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: string[] = [];
  stdinText = '';
  closed = false;

  constructor(private readonly ignoreSigterm = false) {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (text: string) => {
      this.stdinText += text;
    });
  }

  kill(signal: string = 'SIGTERM'): boolean {
    this.signals.push(signal);
    if (signal === 'SIGTERM' && this.ignoreSigterm) {
      return true;
    }
    this.exit(null);
    return true;
  }

  writeLine(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  exit(code: number | null): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code));
  }
}

interface SpawnCall {
  args: readonly string[];
  cwd?: string;
  child: FakeChild;
}

/** A fake `spawn`; `script` decides what each started child does. */
function fakeSpawn(script: (call: SpawnCall) => void, options: { ignoreSigterm?: boolean } = {}) {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFunction = (_command, args, spawnOptions) => {
    const child = new FakeChild(options.ignoreSigterm);
    const call: SpawnCall = { args, ...(spawnOptions.cwd === undefined ? {} : { cwd: spawnOptions.cwd }), child };
    calls.push(call);
    setImmediate(() => script(call));
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

function notFoundSpawn(): SpawnFunction {
  return () => {
    const child = new FakeChild();
    setImmediate(() => {
      const error = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      child.stdout.end();
      child.stderr.end();
      child.emit('error', error);
    });
    return child as unknown as ChildProcess;
  };
}

function message(role: Message['role'], content: string): Message {
  return { id: `${role}-${content}`, role, content, createdAt: 0 };
}

const textDelta = (text: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});
const success = (result: string) => ({ type: 'result', subtype: 'success', is_error: false, result });

async function collect(events: AsyncIterable<AIStreamEvent>): Promise<AIStreamEvent[]> {
  const out: AIStreamEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
}

function request(signal = new AbortController().signal, projectPath: string | null = null) {
  return { messages: [message('user', 'Hello')], projectPath, signal };
}

describe('parseStreamLine', () => {
  it('reads text deltas and ignores other events', () => {
    expect(parseStreamLine(JSON.stringify(textDelta('Hi')))).toEqual({ type: 'text-delta', text: 'Hi' });
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toBeUndefined();
    expect(parseStreamLine('not json')).toBeUndefined();
    expect(parseStreamLine('[]')).toBeUndefined();
  });

  it('turns a failed result into an error', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' });
    expect(parseStreamLine(line)).toEqual({ type: 'error', message: 'Claude CLI: boom' });
  });
});

describe('buildPrompt', () => {
  it('sends a single message as it is', () => {
    expect(buildPrompt([message('user', 'Hello')])).toBe('Hello');
    expect(buildPrompt([])).toBe('');
  });

  it('writes earlier turns into the prompt, oldest first, ending with the last user message', () => {
    const prompt = buildPrompt([
      message('user', 'My name is Sam.'),
      message('assistant', 'Hi Sam!'),
      message('system', 'Reply stopped.'),
      message('user', 'What is my name?'),
    ]);
    expect(prompt).toContain('User: My name is Sam.\n\nAssistant: Hi Sam!\n\nUser: What is my name?');
    expect(prompt.endsWith('User: What is my name?')).toBe(true);
    expect(prompt).not.toContain('Reply stopped.');
  });
});

describe('buildReplyArgs', () => {
  it('streams JSON with tools, MCP servers and user settings off, and adds the model only when given', () => {
    const args = buildReplyArgs();
    expect(args).toEqual(expect.arrayContaining(['--print', 'stream-json', '--include-partial-messages']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args).not.toContain('--model');
    expect(buildReplyArgs('sonnet').slice(-2)).toEqual(['--model', 'sonnet']);
  });
});

describe('Claude CLI provider: replies', () => {
  it('streams text, writes the prompt to stdin, and runs in the project folder', async () => {
    const { spawn, calls } = fakeSpawn(({ child }) => {
      child.writeLine({ type: 'system', subtype: 'init' });
      child.writeLine(textDelta('Hel'));
      child.writeLine(textDelta('lo!'));
      child.writeLine(success('Hello!'));
      child.exit(0);
    });
    const provider = createClaudeCliProvider({ spawn });
    const events = await collect(provider.streamChat(request(undefined, '/project')));

    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo!' },
      { type: 'completed' },
    ]);
    expect(calls[0]?.cwd).toBe('/project');
    expect(calls[0]?.child.stdinText).toContain('Hello');
    expect(calls[0]?.args).not.toContain('Hello');
    expect(provider.runningCount).toBe(0);
  });

  it('uses the final result text when nothing was streamed', async () => {
    const { spawn } = fakeSpawn(({ child }) => {
      child.writeLine(success('Whole reply'));
      child.exit(0);
    });
    const events = await collect(createClaudeCliProvider({ spawn }).streamChat(request()));
    expect(events).toEqual([{ type: 'text-delta', text: 'Whole reply' }, { type: 'completed' }]);
  });

  it('reports a failed result', async () => {
    const { spawn } = fakeSpawn(({ child }) => {
      child.writeLine({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' });
      child.exit(1);
    });
    const events = await collect(createClaudeCliProvider({ spawn }).streamChat(request()));
    expect(events).toEqual([{ type: 'error', message: 'Claude CLI: error_max_turns' }]);
  });

  it('reports an exit with no result, with the end of stderr', async () => {
    const { spawn } = fakeSpawn(({ child }) => {
      child.stderr.write('Invalid API key\n');
      child.exit(1);
    });
    const events = await collect(createClaudeCliProvider({ spawn }).streamChat(request()));
    expect(events).toEqual([
      { type: 'error', message: 'Claude CLI stopped without a reply (exit code 1): Invalid API key' },
    ]);
  });

  it('reports a missing CLI', async () => {
    const events = await collect(createClaudeCliProvider({ spawn: notFoundSpawn() }).streamChat(request()));
    expect(events).toEqual([{ type: 'error', message: CLAUDE_CLI_REASONS.notFound }]);
  });
});

describe('Claude CLI provider: stopping', () => {
  it('cancelling ends the child process and yields nothing more', async () => {
    const controller = new AbortController();
    const { spawn, calls } = fakeSpawn(({ child }) => {
      child.writeLine(textDelta('Partial'));
    });
    const provider = createClaudeCliProvider({ spawn });
    const events: AIStreamEvent[] = [];
    for await (const event of provider.streamChat(request(controller.signal))) {
      events.push(event);
      controller.abort();
    }
    expect(events).toEqual([{ type: 'text-delta', text: 'Partial' }]);
    expect(calls[0]?.child.signals).toEqual(['SIGTERM']);
    await new Promise((resolve) => setImmediate(resolve));
    expect(provider.runningCount).toBe(0);
  });

  it('kills a child that ignores the polite stop after the grace period', async () => {
    const controller = new AbortController();
    const { spawn, calls } = fakeSpawn(() => controller.abort(), { ignoreSigterm: true });
    const provider = createClaudeCliProvider({ spawn, killGraceMs: 5 });
    await collect(provider.streamChat(request(controller.signal)));
    expect(calls[0]?.child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(provider.runningCount).toBe(0);
  });

  it('does not start a child for a request that is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { spawn, calls } = fakeSpawn(() => undefined);
    expect(await collect(createClaudeCliProvider({ spawn }).streamChat(request(controller.signal)))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('stopAll() kills every running child (app quit)', async () => {
    const { spawn, calls } = fakeSpawn(({ child }) => child.writeLine(textDelta('Working')), {
      ignoreSigterm: true,
    });
    const provider = createClaudeCliProvider({ spawn });
    const first = provider.streamChat(request())[Symbol.asyncIterator]();
    const second = provider.streamChat(request())[Symbol.asyncIterator]();
    await Promise.all([first.next(), second.next()]);
    expect(provider.runningCount).toBe(2);

    provider.stopAll();
    expect(calls.map((call) => call.child.signals)).toEqual([['SIGKILL'], ['SIGKILL']]);
    await Promise.all([first.next(), second.next()]);
    expect(provider.runningCount).toBe(0);
  });
});

describe('Claude CLI provider: availability', () => {
  function availabilitySpawn(statusOutput: string) {
    return fakeSpawn(({ args, child }) => {
      child.stdout.write(args[0] === '--version' ? '2.1.0 (Claude Code)\n' : statusOutput);
      child.exit(0);
    });
  }

  it('is available when signed in', async () => {
    const { spawn, calls } = availabilitySpawn(JSON.stringify({ loggedIn: true, email: 'someone@example.com' }));
    expect(await createClaudeCliProvider({ spawn }).checkAvailability()).toEqual({ available: true });
    expect(calls.map((call) => call.args)).toEqual([['--version'], ['auth', 'status', '--json']]);
  });

  it('says why when not signed in', async () => {
    const { spawn } = availabilitySpawn(JSON.stringify({ loggedIn: false }));
    expect(await createClaudeCliProvider({ spawn }).checkAvailability()).toEqual({
      available: false,
      reason: CLAUDE_CLI_REASONS.notSignedIn,
    });
  });

  it('says why when the CLI is missing', async () => {
    expect(await createClaudeCliProvider({ spawn: notFoundSpawn() }).checkAvailability()).toEqual({
      available: false,
      reason: CLAUDE_CLI_REASONS.notFound,
    });
  });

  it('gives a general reason when the status cannot be read', async () => {
    const { spawn } = availabilitySpawn('not json');
    expect(await createClaudeCliProvider({ spawn }).checkAvailability()).toEqual({
      available: false,
      reason: CLAUDE_CLI_REASONS.checkFailed,
    });
  });

  it('gives up on a check that hangs', async () => {
    const { spawn, calls } = fakeSpawn(() => undefined, { ignoreSigterm: true });
    const status = await createClaudeCliProvider({ spawn, checkTimeoutMs: 5 }).checkAvailability();
    expect(status).toEqual({ available: false, reason: CLAUDE_CLI_REASONS.checkFailed });
    expect(calls[0]?.child.signals).toEqual(['SIGKILL']);
  });
});
