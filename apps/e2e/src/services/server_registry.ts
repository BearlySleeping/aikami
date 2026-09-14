// apps/e2e/src/services/server_registry.ts
//
// Tracks App-server processes the preflight spawned itself and stops them in
// global teardown.
//
// Why a registry: preflight and teardown run in the same Playwright main
// process (verified), so module state set in global_setup is NOT shared with
// global_teardown (separate module graphs) — but `globalThis` is. Servers
// started via herdr are deliberately NOT stopped here: herdr tabs are meant
// to outlive a single test run.

export type SpawnedServer = {
  label: string;
  pid: number;
  /** Process log, for when a test run fails mysteriously. */
  logFile: string;
};

const REGISTRY_KEY = '__AIKAMI_E2E_SPAWNED_SERVERS__';

type Registry = { spawned: SpawnedServer[] };

export const getRegistry = (): Registry => {
  const holder = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: Registry;
  };
  if (!holder[REGISTRY_KEY]) {
    holder[REGISTRY_KEY] = { spawned: [] };
  }
  return holder[REGISTRY_KEY];
};

export const trackSpawned = (server: SpawnedServer): void => {
  getRegistry().spawned.push(server);
};

/**
 * SIGTERM each spawned process group, then SIGKILL anything still alive.
 *
 * Detached spawns become their own process-group leader, so killing -pid
 * takes the whole tree (vite's esbuild children, etc.) with it. Errors are
 * swallowed: a server Playwright didn't start may already be gone.
 */
export const stopSpawnedServers = (): void => {
  const { spawned } = getRegistry();
  getRegistry().spawned = [];
  for (const server of spawned) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  }
  // Give the SIGTERMs a moment, then escalate for anything still bound.
  setTimeout(() => {
    for (const server of spawned) {
      try {
        process.kill(-server.pid, 'SIGKILL');
      } catch {
        // Already exited — expected for a graceful SIGTERM shutdown.
      }
    }
  }, 750);
};
