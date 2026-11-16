import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AIProviderStatus, Message } from '../../../shared/types';
import type { AIChatRequest, AIProviderAdapter, AIStreamEvent } from '../adapter';

/**
 * The Claude CLI provider: replies come from the locally installed `claude`
 * command, signed in with the user's own account. Each reply runs one child
 * process in print mode with streaming JSON output. Chat only: the CLI's
 * tools, MCP servers and the user's settings (hooks included) are switched
 * off, so the child starts no processes of its own and needs no permission
 * prompts.
 *
 * No Electron imports, so it can be unit-tested with a fake `spawn`.
 */

/** The parts of `child_process.spawn` this provider uses. Tests pass a fake. */
export type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; stdio: ['pipe', 'pipe', 'pipe']; windowsHide: true },
) => ChildProcess;

export interface ClaudeCliOptions {
  /** The command to run. Defaults to `claude`, found on PATH. */
  command?: string;
  spawn?: SpawnFunction;
  /** How long a cancelled reply may take to exit before it is killed. */
  killGraceMs?: number;
  /** How long an availability check may run before it counts as failed. */
  checkTimeoutMs?: number;
}

export interface ClaudeCliProvider extends AIProviderAdapter {
  /** Kills every child process still running. Called when the app quits. */
  stopAll(): void;
  /** Child processes still running, for tests. */
  readonly runningCount: number;
}

export const CLAUDE_CLI_REASONS = {
  notFound: 'Claude CLI not found. Install Claude Code, then restart EngineerIDE.',
  notSignedIn: 'Claude CLI is not signed in. Run "claude auth login" in a terminal.',
  checkFailed: 'Could not check the Claude CLI. Run "claude auth status" in a terminal to see why.',
} as const;

/** Arguments for one reply. The prompt goes to stdin, never on the command line. */
export function buildReplyArgs(model?: string): string[] {
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    '',
    '--strict-mcp-config',
    // Skips the user's ~/.claude settings, so their hooks and output style
    // neither run nor change the reply. Sign-in is not a setting and still works.
    '--setting-sources',
    '',
    '--no-session-persistence',
  ];
  if (model !== undefined) {
    args.push('--model', model);
  }
  return args;
}

/**
 * Turns the conversation into the single prompt the CLI reads from stdin.
 * Print mode takes one prompt, not a list of messages, so earlier turns must
 * be written into it for the reply to know what was said before.
 */
export function buildPrompt(messages: readonly Message[]): string {
  const turns = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (turns.length <= 1) {
    return turns[0]?.content ?? '';
  }
  const transcript = turns
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  return `Here is our conversation so far. Reply to the last User message as the Assistant, without a label.\n\n${transcript}`;
}

/**
 * Reads one line of the CLI's `stream-json` output. Returns the event it
 * stands for, `'result-text'` for a final result whose text may not have been
 * streamed, or `undefined` for lines that carry no reply text.
 */
export function parseStreamLine(
  line: string,
): AIStreamEvent | { type: 'result-text'; text: string } | undefined {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(data)) {
    return undefined;
  }
  if (data.type === 'stream_event' && isRecord(data.event)) {
    const { event } = data;
    if (event.type === 'content_block_delta' && isRecord(event.delta)) {
      const { delta } = event;
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text !== '') {
        return { type: 'text-delta', text: delta.text };
      }
    }
    return undefined;
  }
  if (data.type === 'result') {
    const resultText = typeof data.result === 'string' ? data.result : '';
    if (data.is_error === true || data.subtype !== 'success') {
      const detail = resultText.trim() || String(data.subtype ?? 'unknown error');
      return { type: 'error', message: `Claude CLI: ${shorten(detail)}` };
    }
    return { type: 'result-text', text: resultText };
  }
  return undefined;
}

export function createClaudeCliProvider(options: ClaudeCliOptions = {}): ClaudeCliProvider {
  const command = options.command ?? 'claude';
  const spawn: SpawnFunction = options.spawn ?? ((cmd, args, opts) => nodeSpawn(cmd, args, opts));
  const killGraceMs = options.killGraceMs ?? 2000;
  const checkTimeoutMs = options.checkTimeoutMs ?? 10_000;
  const running = new Set<ChildProcess>();

  function start(args: readonly string[], cwd?: string): ChildProcess {
    const child = spawn(command, args, {
      ...(cwd === undefined ? {} : { cwd }),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    running.add(child);
    const forget = (): void => {
      running.delete(child);
    };
    child.once('close', forget);
    child.once('error', forget);
    return child;
  }

  /** Runs a short command and collects its output. Never rejects. */
  function run(args: readonly string[]): Promise<{ code: number | null; stdout: string; notFound: boolean }> {
    return new Promise((resolve) => {
      let stdout = '';
      let settled = false;
      const child = start(args);
      const finish = (code: number | null, notFound: boolean): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ code, stdout, notFound });
        }
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(null, false);
      }, checkTimeoutMs);
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (text: string) => {
        stdout += text;
      });
      child.stdin?.end();
      child.once('error', (error: NodeJS.ErrnoException) => finish(null, error.code === 'ENOENT'));
      child.once('close', (code: number | null) => finish(code, false));
    });
  }

  async function checkAvailability(): Promise<AIProviderStatus> {
    const version = await run(['--version']);
    if (version.notFound) {
      return { available: false, reason: CLAUDE_CLI_REASONS.notFound };
    }
    if (version.code !== 0) {
      return { available: false, reason: CLAUDE_CLI_REASONS.checkFailed };
    }
    // The status output names the account; only `loggedIn` is read, and
    // nothing from it is stored or logged.
    const status = await run(['auth', 'status', '--json']);
    try {
      const parsed: unknown = JSON.parse(status.stdout);
      if (isRecord(parsed) && typeof parsed.loggedIn === 'boolean') {
        return parsed.loggedIn
          ? { available: true }
          : { available: false, reason: CLAUDE_CLI_REASONS.notSignedIn };
      }
    } catch {
      // Falls through to the generic reason.
    }
    return { available: false, reason: CLAUDE_CLI_REASONS.checkFailed };
  }

  async function* streamChat(request: AIChatRequest): AsyncIterable<AIStreamEvent> {
    const { signal } = request;
    if (signal.aborted) {
      return;
    }
    const child = start(buildReplyArgs(request.model), request.projectPath ?? undefined);

    let spawnError: NodeJS.ErrnoException | undefined;
    let stderrTail = '';
    const exited = new Promise<number | null>((resolve) => {
      child.once('close', (code: number | null) => resolve(code));
      child.once('error', (error: NodeJS.ErrnoException) => {
        spawnError = error;
        resolve(null);
      });
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => {
      stderrTail = (stderrTail + text).slice(-500);
    });

    // Cancel: ask politely, then force it after the grace period.
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    // A write to a child that failed to start emits 'error' on stdin; it is
    // reported through `exited` instead.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(buildPrompt(request.messages));

    let streamedText = false;
    let finalEvent: AIStreamEvent | undefined;
    try {
      if (child.stdout !== null) {
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        for await (const line of lines) {
          if (signal.aborted) {
            break;
          }
          const event = parseStreamLine(line);
          if (event === undefined) {
            continue;
          }
          if (event.type === 'text-delta') {
            streamedText = true;
            yield event;
          } else if (event.type === 'result-text') {
            // Without partial messages the text arrives only here.
            if (!streamedText && event.text !== '') {
              yield { type: 'text-delta', text: event.text };
            }
            finalEvent = { type: 'completed' };
          } else {
            finalEvent = event;
          }
        }
      }
      const code = await exited;
      if (signal.aborted) {
        return;
      }
      if (spawnError !== undefined) {
        yield {
          type: 'error',
          message: spawnError.code === 'ENOENT' ? CLAUDE_CLI_REASONS.notFound : spawnError.message,
        };
        return;
      }
      if (finalEvent !== undefined) {
        yield finalEvent;
        return;
      }
      const detail = stderrTail.trim();
      yield {
        type: 'error',
        message: `Claude CLI stopped without a reply (exit code ${String(code)})${detail === '' ? '.' : `: ${shorten(detail)}`}`,
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
      // Also covers a consumer that stops reading early.
      if (running.has(child)) {
        child.kill('SIGTERM');
        if (killTimer === undefined) {
          killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
        }
      }
      void exited.then(() => clearTimeout(killTimer));
    }
  }

  return {
    id: 'claude-cli',
    label: 'Claude Sub (CLI)',
    checkAvailability,
    streamChat,
    stopAll(): void {
      for (const child of running) {
        child.kill('SIGKILL');
      }
    },
    get runningCount(): number {
      return running.size;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shorten(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
