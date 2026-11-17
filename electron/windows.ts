import { app, BrowserWindow, dialog, screen, type WebContents } from 'electron';
import type { WindowKind } from '../shared/types';
import { parseWindowBounds, placeWindow, serializeWindowBounds } from './windowBounds';

const WINDOW_BACKGROUND_COLOR = '#1c1c1f';

// A resize or move is saved once it has settled for this long.
const SAVE_BOUNDS_DELAY_MS = 500;

/** Called with a window's size (and position where known) to save, as JSON. */
export type BoundsListener = (kind: WindowKind, bounds: string) => void;

/**
 * Under Wayland an app cannot know its own window position (see
 * `electron/windowBounds.ts`), so only the size is saved there.
 */
function canKnowWindowPosition(): boolean {
  if (process.platform !== 'linux') return true;
  if (app.commandLine.getSwitchValue('ozone-platform') === 'x11') return true;
  return process.env.XDG_SESSION_TYPE !== 'wayland' && process.env.WAYLAND_DISPLAY === undefined;
}

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
  private savedBounds: Partial<Record<WindowKind, string>> = {};
  private boundsListener: BoundsListener | null = null;

  /**
   * Opens windows at their saved size from now on, and reports each later
   * change to `listener` (Phase 3c). Called by storage before any window opens.
   */
  rememberBounds(saved: Partial<Record<WindowKind, string>>, listener: BoundsListener): void {
    this.savedBounds = saved;
    this.boundsListener = listener;
  }

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
    const placement = placeWindow(
      WINDOW_LAYOUTS[kind],
      parseWindowBounds(this.savedBounds[kind]),
      screen.getAllDisplays().map((display) => display.workArea),
    );
    const window = new BrowserWindow({
      ...WINDOW_LAYOUTS[kind],
      width: placement.width,
      height: placement.height,
      ...(placement.x === undefined || placement.y === undefined
        ? {}
        : { x: placement.x, y: placement.y }),
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

    window.once('ready-to-show', () => {
      if (placement.isMaximized) {
        window.maximize();
      }
      window.show();
    });
    this.trackBounds(kind, window);

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

  /** Saves the window's size after it settles, and once more as it closes. */
  private trackBounds(kind: WindowKind, window: BrowserWindow): void {
    const canKnowPosition = canKnowWindowPosition();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      if (window.isDestroyed() || window.isMinimized() || this.boundsListener === null) return;
      this.boundsListener(
        kind,
        serializeWindowBounds(window.getNormalBounds(), window.isMaximized(), canKnowPosition),
      );
    };
    const saveSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_BOUNDS_DELAY_MS);
    };
    window.on('resize', saveSoon);
    window.on('move', saveSoon);
    window.on('maximize', saveSoon);
    window.on('unmaximize', saveSoon);
    window.on('close', save);
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
