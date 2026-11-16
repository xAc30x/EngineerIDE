/** IPC channel names shared by the main process and the preload script. */
export const IPC_CHANNELS = {
  selectFolder: 'fs:selectFolder',
  readDir: 'fs:readDir',
} as const;
