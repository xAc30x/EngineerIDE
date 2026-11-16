import type { ElectronAPI } from './index';

declare global {
  interface Window {
    /**
     * Set by `electron/preload.ts`. Undefined when the renderer is opened in
     * a regular browser, so callers must check before using it.
     */
    electronAPI?: ElectronAPI;
  }
}

export {};
