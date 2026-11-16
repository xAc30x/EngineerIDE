import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcResult } from '../../shared/types';
import type { WindowRegistry } from '../windows';

const UNTRUSTED_SENDER_ERROR = 'Request rejected: it did not come from an application window.';

type Handler<T> = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => IpcResult<T> | Promise<IpcResult<T>>;

/**
 * Registers a request handler that answers only the app's own windows and
 * reports every failure as an `IpcResult` instead of throwing. Arguments
 * arrive as `unknown`; the handler must validate them.
 */
export function handleFromAppWindow<T>(
  channel: string,
  windows: WindowRegistry,
  handler: Handler<T>,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<T>> => {
    if (windows.kindOf(event.sender) === null) {
      return { ok: false, error: UNTRUSTED_SENDER_ERROR };
    }
    try {
      return await handler(event, ...args);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
