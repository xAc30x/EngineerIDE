import type { IpcResult } from '../../shared/types';
import {
  STORAGE_ERRORS,
  type StorageReplies,
  type StorageRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

/**
 * Main's side of the storage worker (Phase 3b). Sends requests, matches each
 * answer to its request by id, and turns a crashed or stopped worker into an
 * error value instead of a promise that never settles. No Electron imports:
 * tests pass a fake port.
 */

/** The parts of a `Worker` the client uses. */
export interface WorkerPort {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

type Pending = (result: IpcResult<unknown>) => void;

function isResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { id, result } = value as Record<string, unknown>;
  if (typeof id !== 'number' || typeof result !== 'object' || result === null) return false;
  return typeof (result as Record<string, unknown>).ok === 'boolean';
}

export class StorageClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stopped = false;

  constructor(private readonly port: WorkerPort) {
    port.on('message', (message) => {
      if (!isResponse(message)) return;
      const settle = this.pending.get(message.id);
      this.pending.delete(message.id);
      settle?.(message.result);
    });
    port.on('error', () => this.stop());
    port.on('exit', () => this.stop());
  }

  /** False once the worker has crashed, exited, or been closed. */
  get isRunning(): boolean {
    return !this.stopped;
  }

  request<K extends StorageRequest['type']>(
    request: Extract<StorageRequest, { type: K }>,
  ): Promise<IpcResult<StorageReplies[K]>> {
    if (this.stopped) {
      return Promise.resolve({ ok: false, error: STORAGE_ERRORS.workerStopped });
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve as Pending);
      try {
        this.port.postMessage({ id, request });
      } catch {
        this.pending.delete(id);
        resolve({ ok: false, error: STORAGE_ERRORS.workerStopped });
      }
    });
  }

  /** Closes the database after every earlier request, then ends the worker. */
  async close(): Promise<void> {
    if (this.stopped) return;
    await this.request({ type: 'close' });
    this.stop();
    await this.port.terminate();
  }

  /** Settles every request still waiting, so none hangs. */
  private stop(): void {
    this.stopped = true;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const settle of waiting) {
      settle({ ok: false, error: STORAGE_ERRORS.workerStopped });
    }
  }
}
