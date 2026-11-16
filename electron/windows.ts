import { app, BrowserWindow, dialog, type WebContents } from 'electron';
import type { WindowKind } from '../shared/types';

const WINDOW_BACKGROUND_COLOR = '#1c1c1f';

interface WindowLayout {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

const WINDOW_LAYOUTS: Readonly<Record<WindowKind, WindowLayout>> = {
  workspace: { width: 1440, height: 900, minWidth: 1024, minHeight: 640 },
  ide: { width: 1280, height: 860, minWidth: 900, minHeight: 560 },
};

export interface WindowRegistryOptions {
  preloadPath: string;
  /** The built `index.html`, used when no dev server is running. */
  rendererIndexPath: string;
  /** Set by vite-plugin-electron while `npm run dev` is running. */
  devServerUrl: string | undefined;
}

/**
 * The only place that creates windows. It holds at most one window of each
 * kind, applies the close and quit rules, and knows which senders are app
 * windows.
 */
export class WindowRegistry {
  private readonly windows = new Map<WindowKind, BrowserWindow>();
  private isQuitting = false;

  constructor(private readonly options: WindowRegistryOptions) {
    app.on('before-quit', () => {
      this.isQuitting = true;
    });
  }

  /** Opens the window, or brings it to the front when it already exists. */
  show(kind: WindowKind): void {
    const existing = this.windows.get(kind);
    if (existing === undefined) {
      this.windows.set(kind, this.create(kind));
      return;
    }
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.show();
    existing.focus();
  }

  /** The kind of the window that owns `sender`, or `null` when it is not an app window. */
  kindOf(sender: WebContents): WindowKind | null {
    for (const [kind, window] of this.windows) {
      if (window.webContents === sender) {
        return kind;
      }
    }
    return null;
  }

  /** Sends a message to every open window, including hidden ones. */
  broadcast(channel: string, payload: unknown): void {
    for (const window of this.windows.values()) {
      window.webContents.send(channel, payload);
    }
  }

  private create(kind: WindowKind): BrowserWindow {
    const window = new BrowserWindow({
      ...WINDOW_LAYOUTS[kind],
      backgroundColor: WINDOW_BACKGROUND_COLOR,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    window.once('ready-to-show', () => window.show());

    // Windows are opened only by this registry, and a window never leaves its own page.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (!this.isAllowedNavigation(targetUrl)) {
        event.preventDefault();
      }
    });

    window.on('close', (event) => this.handleClose(event, window));
    window.on('closed', () => {
      this.windows.delete(kind);
      // A window is only really closed when it was the last visible one, so
      // the app ends here. A hidden window may remain; quitting closes it.
      if (!this.isQuitting) {
        app.quit();
      }
    });

    this.load(window, kind).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('EngineerIDE could not load its interface', detail);
    });

    return window;
  }

  /**
   * Runs when a window is about to close (its close button, Alt+F4, or the
   * app quitting). Closing a window affects only that window: it is hidden
   * instead of destroyed, so opening it again keeps its state, for example
   * the expanded folders or an unsent draft. The app ends when the last
   * visible window is closed.
   */
  private handleClose(event: { preventDefault(): void }, window: BrowserWindow): void {
    // While quitting the close must go through: cancelling it would cancel
    // the quit and leave the app running with no visible window.
    if (this.isQuitting) {
      return;
    }
    const isOtherWindowVisible = [...this.windows.values()].some(
      (other) => other !== window && other.isVisible(),
    );
    if (!isOtherWindowVisible) {
      // Nothing else is on screen: let this window close, which ends the app.
      return;
    }
    event.preventDefault();
    window.hide();
  }

  /** Both windows load the same page; the query tells the renderer which layout to show. */
  private load(window: BrowserWindow, kind: WindowKind): Promise<void> {
    const { devServerUrl, rendererIndexPath } = this.options;
    if (devServerUrl === undefined) {
      return window.loadFile(rendererIndexPath, { query: { window: kind } });
    }
    const url = new URL(devServerUrl);
    url.searchParams.set('window', kind);
    return window.loadURL(url.toString());
  }

  /** In development only the dev server origin may be navigated to; in production nothing may. */
  private isAllowedNavigation(targetUrl: string): boolean {
    const { devServerUrl } = this.options;
    if (devServerUrl === undefined) {
      return false;
    }
    try {
      return new URL(targetUrl).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
}
