// apps/e2e/src/services/server_registry.ts
//
// Tracks only processes spawned by the current E2E run. The registry is kept
// on globalThis because Playwright loads global setup and teardown through
// separate module graphs.

export type SpawnedServer = {
  label: string;
  pid: number;
  /** Process log, for when a test run fails mysteriously. */
  logFile: string;
  /** Preflight invocation that created this process. */
  runId?: string;
};

export type SpawnedServerRegistry = { spawned: SpawnedServer[] };

const REGISTRY_KEY = '__AIKAMI_E2E_SPAWNED_SERVERS__';

export const getRegistry = (): SpawnedServerRegistry => {
  const holder = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: SpawnedServerRegistry;
  };
  if (!holder[REGISTRY_KEY]) {
    holder[REGISTRY_KEY] = { spawned: [] };
  }
  return holder[REGISTRY_KEY];
};

/**
 * Register a child process. PID zero is the spawn failure sentinel used by
 * Node/Bun and must never reach process.kill(-pid), which would target the
 * caller's entire process group.
 */
export const trackSpawned = (server: SpawnedServer): boolean => {
  if (!Number.isInteger(server.pid) || server.pid <= 0) {
    return false;
  }
  getRegistry().spawned.push(server);
  return true;
};

/** Clear registry entries without signalling anything (useful for test setup). */
export const clearSpawnedServers = (): void => {
  getRegistry().spawned = [];
};

export type StopSpawnedServersOptions = {
  /** If supplied, stop only entries created by this preflight invocation. */
  runId?: string;
  /** Injectable signal seam for deterministic tests. */
  kill?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  /** Injectable timer seam for deterministic tests. */
  schedule?: (callback: () => void, milliseconds: number) => unknown;
  /** Escalation delay; set to 0 to skip the second signal. */
  killAfterMs?: number;
};

const defaultKill = (pid: number, signal: 'SIGTERM' | 'SIGKILL'): void => {
  process.kill(-pid, signal);
};

/**
 * SIGTERM each registered process group, then SIGKILL anything still alive.
 * Entries are removed before signalling, so a later teardown cannot signal a
 * process twice. No Herdr or foreign-listener entry can be present here.
 */
export const stopSpawnedServers = (options: StopSpawnedServersOptions = {}): void => {
  const registry = getRegistry();
  const spawned = registry.spawned.filter(
    (server) => options.runId === undefined || server.runId === options.runId,
  );
  registry.spawned = registry.spawned.filter(
    (server) => options.runId !== undefined && server.runId !== options.runId,
  );
  if (spawned.length === 0) {
    return;
  }

  const kill = options.kill ?? defaultKill;
  for (const server of spawned) {
    try {
      kill(server.pid, 'SIGTERM');
    } catch {
      // Already exited — expected during best-effort cleanup.
    }
  }

  const killAfterMs = options.killAfterMs ?? 750;
  if (killAfterMs <= 0) {
    return;
  }
  const escalate = (): void => {
    for (const server of spawned) {
      try {
        kill(server.pid, 'SIGKILL');
      } catch {
        // Graceful shutdown won the race.
      }
    }
  };
  const timer = (options.schedule ?? setTimeout)(escalate, killAfterMs);
  (timer as { unref?: () => void }).unref?.();
};
