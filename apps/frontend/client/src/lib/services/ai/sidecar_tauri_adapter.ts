// apps/frontend/client/src/lib/services/ai/sidecar_tauri_adapter.ts

import type { SidecarChildProcess } from '$types';

/** Spawns the configured bundled sidecar through Tauri's scoped shell API. */
export const spawnTauriSidecar = async (options: {
  readonly binaryName: string;
  readonly args: readonly string[];
}): Promise<SidecarChildProcess> => {
  const { Command } = await import('@tauri-apps/plugin-shell');
  const command = Command.sidecar(options.binaryName, [...options.args]);
  const child = await command.spawn();
  return {
    async kill(): Promise<void> {
      try {
        await child.kill();
      } catch {
        // Process may already be dead.
      }
    },
  };
};

/** Registers an async callback for the current Tauri window's close request. */
export const registerTauriCloseHandler = async (onClose: () => Promise<void>): Promise<void> => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().onCloseRequested(async () => {
    await onClose();
  });
};
