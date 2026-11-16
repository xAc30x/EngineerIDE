import type { ElectronAPI } from '../types';

/**
 * The preload bridge, or `undefined` when the page runs outside the desktop
 * app (a regular browser, or a unit test).
 */
export function getBridge(): ElectronAPI | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI;
}
