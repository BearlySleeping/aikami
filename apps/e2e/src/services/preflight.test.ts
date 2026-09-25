// apps/e2e/src/services/preflight.test.ts
// Unit tests for the per-run preflight orchestration — every process/env
// effect goes through the injectable PreflightIo, so these run hermetically.

import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentIdentitySnapshot } from '@aikami/types';

import { E2E_PORT_OFFSET, IS_E2E_CI } from '../config';
import {
  buildMontageLayout,
  createChecksumRecord,
  createChecksumRecords,
  createEvidenceManifest,
  createMontageLayout,
  type EvidenceCaptureRecord,
  type EvidenceIdentity,
  type EvidenceOrigin,
  normalizeEvidenceOrigin,
  pairEvidenceCaptures,
  renderChecksumsFile,
  renderEvidenceIndex,
  sha256Hex,
  validateEvidenceLaneRequests,
} from '../visual/core/evidence.ts';
import {
  allocatePortOffset,
  E2E_PORT_ALLOCATION_DIR,
  E2E_PORT_OFFSETS,
  E2E_PORT_SLOTS,
  E2E_PORT_STEP,
  isPortAvailableSync,
  type PortAllocationRecord,
  type PortAllocationStore,
  parseExplicitPortOffset,
  portOffsetsForSlots,
  portsForOffset,
  preferredPortSlot,
  resolveE2EPortOffset,
  selectPortOffset,
  withPortAllocationLock,
} from './port_allocation';
import type {
  ListenerIdentityProbeOptions,
  ListenerOwnershipProbeOptions,
  ListenerOwnershipProbeResult,
  ListenerOwnershipRecordOptions,
  PreflightIo,
} from './preflight';
import { runPreflight } from './preflight';
import {
  clearSpawnedServers,
  getRegistry,
  stopSpawnedServers,
  trackSpawned,
} from './server_registry';
import { FALLBACK_BUILD_ENV, SERVICE_DEFS } from './service_map';

// ── Fake io ──────────────────────────────────────────────────

type SyncCall = {
  command: string;
  args: string[];
  options: { cwd: string; env?: Record<string, string> };
};

type SpawnCall = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  logFile: string;
};

const makeIo = (
  stateOverrides: Partial<{
    probeSequence: boolean[];
    identitySequence: boolean[];
    ownershipSequence: ListenerOwnershipProbeResult[];
    herdrStatus: number;
  }> = {},
  ioOverrides: Partial<PreflightIo> = {},
) => {
  const state = {
    syncCalls: [] as SyncCall[],
    spawns: [] as SpawnCall[],
    probes: 0,
    identityProbes: [] as ListenerIdentityProbeOptions[],
    listenerProbes: [] as ListenerOwnershipProbeOptions[],
    records: [] as ListenerOwnershipRecordOptions[],
    clock: 0,
    // Scripted probe results consumed in order; false forever once exhausted.
    probeSequence: [] as boolean[],
    identitySequence: [] as boolean[],
    ownershipSequence: [] as ListenerOwnershipProbeResult[],
    herdrStatus: 1, // herdr absent by default
    ...stateOverrides,
  };
  const io: PreflightIo = {
    probe: async () => {
      state.probes += 1;
      return state.probeSequence.shift() ?? false;
    },
    probeIdentity: async (options) => {
      state.identityProbes.push(options);
      return state.identitySequence.shift() ?? true;
    },
    probeListener: async (options) => {
      state.listenerProbes.push(options);
      return (
        state.ownershipSequence.shift() ?? {
          proven: true,
          identity: {
            pid: 10_000 + state.listenerProbes.length,
            pidStartTimeMs: 20_000 + state.listenerProbes.length,
          },
          // A reuse-path fake represents a durable Herdr record. Only a
          // trusted detached child is allowed to mint a new record below.
          existingRecord:
            options.trustedParentPid === undefined || options.expectedCwd === undefined,
        }
      );
    },
    recordListener: async (record) => {
      state.records.push(record);
    },
    runSync: (command, args, options) => {
      state.syncCalls.push({ command, args, options });
      return {
        status: command === 'herdr' ? state.herdrStatus : 0,
        stdout: '',
        stderr: '',
      };
    },
    spawnDetached: (command, args, options) => {
      state.spawns.push({
        command,
        args,
        cwd: options.cwd,
        env: options.env,
        logFile: options.logFile,
      });
      return 4000 + state.spawns.length;
    },
    linkedWorktree: () => false,
    gitTopLevel: () => '/repo',
    env: (key) => process.env[key],
    now: () => state.clock,
    sleep: async () => {
      state.clock += 10_000;
    },
    log: () => {},
    stopSpawnedServers: () => {},
  };
  Object.assign(io, ioOverrides);
  return { state, io };
};

const moonRun = (state: { syncCalls: SyncCall[] }): SyncCall | undefined =>
  state.syncCalls.find((call) => call.command === 'bun' && call.args.includes('moon'));

// ── Reuse ────────────────────────────────────────────────────

test('reuses servers that are already up and touches nothing', async () => {
  const { state, io } = makeIo({}, { probe: async () => true });
  const result = await runPreflight({ requestedProjects: ['game', 'hub'], io });
  expect(result).toEqual({ reused: ['client', 'hub'], started: [] });
  expect(state.syncCalls).toEqual([]);
  expect(state.spawns).toEqual([]);
});

test('a selection needing no servers (ai-services) is a no-op', async () => {
  const { state, io } = makeIo();
  const result = await runPreflight({ requestedProjects: ['ai-services'], io });
  expect(result).toEqual({ reused: [], started: [] });
  expect(state.syncCalls).toEqual([]);
  expect(state.spawns).toEqual([]);
});

test('a foreign listener is refused even when it answers HTTP', async () => {
  const { state, io } = makeIo(
    {},
    {
      linkedWorktree: () => true,
      probe: async () => true,
      probeIdentity: async () => false,
      probeListener: async () => ({ proven: false }),
    },
  );

  await expect(runPreflight({ requestedProjects: ['game'], io })).rejects.toThrow(
    /foreign listener/i,
  );
  expect(state.syncCalls).toEqual([]);
  expect(state.spawns).toEqual([]);
});

test('startup liveness without a matching identity never reports ready', async () => {
  const cleanupRunIds: string[] = [];
  const { state, io } = makeIo(
    { probeSequence: [false, true] },
    {
      linkedWorktree: () => true,
      probeIdentity: async () => false,
      probeListener: async () => ({ proven: false }),
      stopSpawnedServers: (options) => cleanupRunIds.push(options.runId),
    },
  );

  await expect(
    runPreflight({
      requestedProjects: ['game'],
      io,
      readyTimeoutMs: 3000,
      runId: 'identity-timeout',
    }),
  ).rejects.toThrow(/timed out waiting for client/);
  expect(state.records).toHaveLength(0);
  expect(cleanupRunIds).toEqual(['identity-timeout']);
});

test('a current-checkout listener is reused without starting a foreign tab', async () => {
  const { state, io } = makeIo(
    {},
    {
      linkedWorktree: () => true,
      probe: async () => true,
      probeIdentity: async () => true,
    },
  );

  const result = await runPreflight({ requestedProjects: ['game'], io });
  expect(result).toEqual({ reused: ['client'], started: [] });
  expect(state.syncCalls).toEqual([]);
  expect(state.spawns).toEqual([]);
});

test('ownership-capable preview listeners can prove checkout identity without an endpoint', async () => {
  const { io } = makeIo(
    {},
    {
      linkedWorktree: () => true,
      probe: async () => true,
      probeIdentity: async () => false,
      probeListener: async ({ service, checkout }) =>
        service === 'site' && checkout === '/repo'
          ? {
              proven: true,
              identity: { pid: 6001, pidStartTimeMs: 7001 },
              existingRecord: true,
            }
          : { proven: false },
    },
  );

  const result = await runPreflight({ requestedProjects: ['site-chromium'], io });
  expect(result).toEqual({ reused: ['site'], started: [] });
});

test('an existing ownership record is reused without being rewritten', async () => {
  const records: ListenerOwnershipRecordOptions[] = [];
  const { io } = makeIo(
    {},
    {
      linkedWorktree: () => true,
      probe: async () => true,
      probeListener: async () => ({
        proven: true,
        identity: { pid: 6301, pidStartTimeMs: 7301 },
        existingRecord: true,
      }),
      recordListener: async (record) => {
        records.push(record);
      },
    },
  );

  await runPreflight({ requestedProjects: ['site-chromium'], io });

  expect(records).toEqual([]);
});

test('selects endpoint and ownership probes by service capability', async () => {
  const { state, io } = makeIo({}, { probe: async () => true });

  await runPreflight({ requestedProjects: ['game', 'site-chromium'], io });

  expect(state.listenerProbes.some((options) => options.service === 'site')).toBe(true);
  expect(state.identityProbes.some((options) => options.serviceId === 'site')).toBe(false);
  if (IS_E2E_CI) {
    expect(state.identityProbes).toHaveLength(0);
  } else {
    expect(state.identityProbes).toHaveLength(1);
    expect(state.identityProbes[0]?.serviceId).toBe('client');
  }
});

test('a reachable ownership listener without a proof is never treated as reusable', async () => {
  const { state, io } = makeIo(
    {},
    {
      linkedWorktree: () => true,
      probe: async () => true,
      probeListener: async () => ({ proven: false }),
    },
  );

  await expect(runPreflight({ requestedProjects: ['site-chromium'], io })).rejects.toThrow(
    /foreign listener/i,
  );
  expect(state.spawns).toEqual([]);
});

test('a trusted spawned listener receives its process-group and expected-cwd proof', async () => {
  const identity = { pid: 6101, pidStartTimeMs: 7101 };
  const { state, io } = makeIo(
    { probeSequence: [false, true] },
    {
      linkedWorktree: () => true,
      probeListener: async (options) => {
        state.listenerProbes.push(options);
        const { trustedParentPid, expectedCwd, service } = options;
        return service === 'site' &&
          trustedParentPid === 4001 &&
          expectedCwd === '/repo/apps/frontend/site'
          ? { proven: true, identity, existingRecord: false }
          : { proven: false };
      },
    },
  );

  await runPreflight({ requestedProjects: ['site-chromium'], io, readyTimeoutMs: 5000 });

  expect(state.listenerProbes.at(-1)).toMatchObject({
    service: 'site',
    checkout: '/repo',
    expectedCwd: '/repo/apps/frontend/site',
    trustedParentPid: 4001,
  });
});

test('persists the exact process identity returned by ownership validation', async () => {
  const identity = { pid: 6201, pidStartTimeMs: 7201 };
  const records: ListenerOwnershipRecordOptions[] = [];
  const { io } = makeIo(
    { probeSequence: [false, true] },
    {
      linkedWorktree: () => true,
      probeListener: async () => ({ proven: true, identity, existingRecord: false }),
      recordListener: async (record) => {
        records.push(record);
      },
    },
  );

  await runPreflight({
    requestedProjects: ['site-chromium'],
    io,
    readyTimeoutMs: 5000,
    runId: 'exact-record-run',
  });

  expect(records).toEqual([
    {
      port: SERVICE_DEFS.site.port,
      service: 'site',
      checkout: '/repo',
      identity,
      runId: 'exact-record-run',
    },
  ]);
});

test('a linked worktree self-manages allocated ports instead of starting Herdr', async () => {
  const { state, io } = makeIo(
    { herdrStatus: 0, probeSequence: [false, true] },
    { linkedWorktree: () => true },
  );

  const result = await runPreflight({ requestedProjects: ['game'], io, readyTimeoutMs: 5000 });
  expect(result.started).toEqual(['client']);
  expect(state.syncCalls.some((call) => call.args.includes('herdr:start'))).toBe(false);
  expect(state.spawns).toHaveLength(1);
  expect(state.spawns[0]?.env.PUBLIC_EMULATOR_PORT_OFFSET).toBe(String(E2E_PORT_OFFSET));
});

test('records listener ownership after a self-managed preview becomes ready', async () => {
  const records: ListenerOwnershipRecordOptions[] = [];
  const { io } = makeIo(
    { probeSequence: [false, true] },
    {
      linkedWorktree: () => true,
      recordListener: async (record) => {
        records.push(record);
      },
    },
  );

  await runPreflight({ requestedProjects: ['site-chromium'], io, readyTimeoutMs: 5000 });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ service: 'site', checkout: '/repo' });
});

// ── Env seed gate ────────────────────────────────────────────

test('missing env seeds fail fast with a worktree:bootstrap pointer', async () => {
  const { state, io } = makeIo();
  io.linkedWorktree = () => true;
  io.runSync = (command, args, options) => {
    state.syncCalls.push({ command, args, options });
    return {
      status: command === 'bun' && args.includes('worktree:bootstrap') ? 1 : 0,
      stdout: 'missing site/.env.emulator',
      stderr: '❌ Missing env seeds in the worktree: apps/frontend/site/.env.emulator',
    };
  };
  expect(
    await runPreflight({ requestedProjects: ['game'], io }).then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    ),
  ).toMatch(/worktree:bootstrap/);
  expect(state.spawns).toEqual([]);
});

test('the root checkout never runs the seed gate (bootstrapWorktree refuses root-mode)', async () => {
  const { state, io } = makeIo({ probeSequence: [false, true] });
  await runPreflight({ requestedProjects: ['game'], io, readyTimeoutMs: 5000 });
  expect(state.syncCalls.filter((call) => call.args.includes('worktree:bootstrap'))).toEqual([]);
});

// ── herdr path ───────────────────────────────────────────────

test('with herdr: dev services start via bun run herdr:start, nothing is spawned', async () => {
  const { state, io } = makeIo({ herdrStatus: 0, probeSequence: [false, false, true, true] });
  const result = await runPreflight({
    requestedProjects: ['game', 'hub'],
    io,
    readyTimeoutMs: 5000,
  });
  expect(result.started).toEqual(['client', 'hub']);
  const startCall = state.syncCalls.find((call) => call.args.includes('herdr:start'));
  expect(startCall?.args).toEqual([
    'run',
    'herdr:start',
    IS_E2E_CI ? 'client,hub-worker' : 'client,hub',
  ]);
  expect(startCall?.options.cwd).toBe('/repo');
  expect(state.spawns).toEqual([]);
  expect(moonRun(state)).toBeUndefined();
});

test('with herdr: client-llm is still self-managed with the flag env', async () => {
  const { state, io } = makeIo({
    herdrStatus: 0,
    probeSequence: [false, false, false, true, true, true],
  });
  await runPreflight({ requestedProjects: ['client-llm-on'], io, readyTimeoutMs: 5000 });
  const startCall = state.syncCalls.find((call) => call.args.includes('herdr:start'));
  expect(startCall?.args).toEqual([
    'run',
    'herdr:start',
    IS_E2E_CI ? 'client,hub-worker' : 'client,hub',
  ]);
  expect(state.spawns).toHaveLength(1);
  expect(state.spawns[0]).toMatchObject({
    command: 'bun',
    args: ['run', 'dev:emulator'],
    cwd: '/repo/apps/frontend/client',
    env: {
      PORT: String(SERVICE_DEFS['client-llm'].port),
      PUBLIC_EMULATOR_PORT_OFFSET: String(E2E_PORT_OFFSET),
      PUBLIC_MUTE_AUDIO: '1',
      PUBLIC_MODE: 'emulator',
      PUBLIC_COMBAT_LLM_AGENTS: '1',
    },
  });
  expect(state.spawns[0]?.logFile).toContain('client-llm.log');
});

test('herdr start failure fails with a manual-start pointer', async () => {
  const { state, io } = makeIo({ herdrStatus: 0 });
  io.runSync = (command, args, options) => {
    state.syncCalls.push({ command, args, options });
    const isStart = command === 'bun' && args.includes('herdr:start');
    return {
      status: isStart ? 1 : 0,
      stdout: '',
      stderr: isStart ? 'EADDRINUSE :5274' : '',
    };
  };
  await expect(
    runPreflight({ requestedProjects: ['game'], io, readyTimeoutMs: 5000 }),
  ).rejects.toThrow(/herdr:start/);
  expect(state.spawns).toEqual([]);
});

// ── No herdr (CI recipe) ─────────────────────────────────────

test('without herdr: site fallback runs the moon build with CI env', async () => {
  const { state, io } = makeIo({ probeSequence: [false, true] });
  const result = await runPreflight({
    requestedProjects: ['site-chromium'],
    io,
    readyTimeoutMs: 5000,
  });
  expect(result.started).toEqual(['site']);
  const moonCall = moonRun(state);
  expect(moonCall?.args).toEqual(['moon', 'run', 'site:build']);
  expect(moonCall?.options.cwd).toBe('/repo');
  expect(moonCall?.options.env?.PUBLIC_APP_ID).toBe(FALLBACK_BUILD_ENV.PUBLIC_APP_ID);
  expect(moonCall?.options.env?.PUBLIC_MODE).toBe(FALLBACK_BUILD_ENV.PUBLIC_MODE);
  expect(state.spawns).toHaveLength(1);
  expect(state.spawns[0]).toMatchObject({
    command: 'bun',
    args: ['run', 'preview'],
    cwd: '/repo/apps/frontend/site',
    env: {
      PORT: String(SERVICE_DEFS.site.port),
      PUBLIC_EMULATOR_PORT_OFFSET: String(E2E_PORT_OFFSET),
    },
  });
  expect(state.spawns[0]?.logFile).toContain('site.log');
});

test('without herdr: Moon checks an existing artifact before it is served', async () => {
  const { state, io } = makeIo({ probeSequence: [false, true] });
  const result = await runPreflight({
    requestedProjects: ['site-chromium'],
    io,
    readyTimeoutMs: 5000,
  });
  expect(result.started).toEqual(['site']);
  expect(moonRun(state)?.args).toEqual(['moon', 'run', 'site:build']);
  expect(state.spawns[0]).toMatchObject({ command: 'bun', args: ['run', 'preview'] });
});

test('game-only fallback starts a dev client and never builds', async () => {
  const { state, io } = makeIo({ probeSequence: [false, true] });
  const result = await runPreflight({ requestedProjects: ['game'], io, readyTimeoutMs: 5000 });
  expect(result.started).toEqual(['client']);
  if (IS_E2E_CI) {
    expect(moonRun(state)?.args).toEqual(['moon', 'run', 'client:build']);
  } else {
    expect(moonRun(state)).toBeUndefined();
  }
  expect(state.spawns).toHaveLength(1);
  expect(state.spawns[0]).toMatchObject({
    command: 'bun',
    args: ['run', IS_E2E_CI ? 'preview' : 'dev:emulator'],
    cwd: '/repo/apps/frontend/client',
    env: {
      PORT: String(SERVICE_DEFS.client.port),
      PUBLIC_EMULATOR_PORT_OFFSET: String(E2E_PORT_OFFSET),
      PUBLIC_MUTE_AUDIO: '1',
      PUBLIC_MODE: 'emulator',
    },
  });
  expect(state.spawns[0]?.logFile).toContain('client.log');
});

// ── Readiness ────────────────────────────────────────────────

test('a zero spawn PID fails before readiness and is not treated as a server', async () => {
  clearSpawnedServers();
  const cleanupRunIds: string[] = [];
  const { io } = makeIo(
    { probeSequence: [false] },
    {
      linkedWorktree: () => true,
      spawnDetached: () => 0,
      stopSpawnedServers: (options) => cleanupRunIds.push(options.runId),
    },
  );

  await expect(
    runPreflight({ requestedProjects: ['game'], io, runId: 'zero-pid-run' }),
  ).rejects.toThrow(/usable PID/);
  expect(getRegistry().spawned.filter((server) => server.runId === 'zero-pid-run')).toHaveLength(0);
  expect(cleanupRunIds).toEqual(['zero-pid-run']);
});

test('a server that never becomes ready fails with its url and log path', async () => {
  const cleanupRunIds: string[] = [];
  const { state, io } = makeIo(
    {},
    {
      probe: async () => false,
      stopSpawnedServers: (options) => cleanupRunIds.push(options.runId),
    },
  );
  await expect(
    runPreflight({ requestedProjects: ['game'], io, readyTimeoutMs: 3000, runId: 'test-run' }),
  ).rejects.toThrow(`timed out waiting for client (game/PWA) at ${SERVICE_DEFS.client.baseUrl}`);
  expect(state.spawns).toHaveLength(1);
  expect(cleanupRunIds).toEqual(['test-run']);
});

describe('spawned server registry', () => {
  beforeEach(() => {
    clearSpawnedServers();
  });

  test('PID zero is not tracked and therefore cannot be signalled', () => {
    const signals: Array<{ pid: number; signal: string }> = [];
    expect(
      trackSpawned({ label: 'failed spawn', pid: 0, logFile: '/tmp/failed.log', runId: 'run-a' }),
    ).toBe(false);
    expect(getRegistry().spawned).toHaveLength(0);

    stopSpawnedServers({
      killAfterMs: 0,
      kill: (pid, signal) => signals.push({ pid, signal }),
    });
    expect(signals).toEqual([]);
  });

  test('failure cleanup stops only the requested run and preserves other entries', () => {
    const signals: Array<{ pid: number; signal: string }> = [];
    trackSpawned({ label: 'client a', pid: 4101, logFile: '/tmp/a.log', runId: 'run-a' });
    trackSpawned({ label: 'client b', pid: 4102, logFile: '/tmp/b.log', runId: 'run-b' });

    stopSpawnedServers({
      runId: 'run-a',
      killAfterMs: 0,
      kill: (pid, signal) => signals.push({ pid, signal }),
    });

    expect(signals).toEqual([{ pid: 4101, signal: 'SIGTERM' }]);
    expect(getRegistry().spawned.map((server) => server.runId)).toEqual(['run-b']);
  });

  test('full teardown drains only registry-owned process entries', () => {
    const signals: number[] = [];
    trackSpawned({ label: 'site', pid: 4201, logFile: '/tmp/site.log', runId: 'run-a' });
    stopSpawnedServers({
      killAfterMs: 0,
      kill: (pid) => signals.push(pid),
    });

    expect(signals).toEqual([4201]);
    expect(getRegistry().spawned).toEqual([]);
  });
});

const makeMemoryPortStore = (): {
  records: PortAllocationRecord[];
  store: PortAllocationStore;
} => {
  const records: PortAllocationRecord[] = [];
  return {
    records,
    store: {
      readRecords: () => records.map((record) => ({ ...record })),
      writeRecord: (_directory, record) => {
        records.push({ ...record });
      },
      withLock: (_directory, action) => action(),
      isPortAvailable: () => true,
      checkoutExists: () => true,
    },
  };
};

describe('port offset space', () => {
  test('uses the reviewed 163-slot x 66-step space and reserves zero for root', () => {
    expect(E2E_PORT_SLOTS).toBe(163);
    expect(E2E_PORT_STEP).toBe(66);
    expect(E2E_PORT_OFFSETS).toHaveLength(163);
    expect(E2E_PORT_OFFSETS[0]).toBe(66);
    expect(E2E_PORT_OFFSETS.at(-1)).toBe(163 * 66);
    expect(E2E_PORT_OFFSETS).not.toContain(0);
    expect(new Set(E2E_PORT_OFFSETS).size).toBe(E2E_PORT_SLOTS);
  });

  test('pure selection probes in deterministic circular order', () => {
    const checkout = '/tmp/checkout-a';
    const startOffset = E2E_PORT_OFFSETS[preferredPortSlot(checkout)];
    const nextOffset = E2E_PORT_OFFSETS[(preferredPortSlot(checkout) + 1) % E2E_PORT_SLOTS];
    expect(
      selectPortOffset({
        checkout,
        isAvailable: (offset) => offset !== startOffset,
      }),
    ).toBe(nextOffset);
  });

  test('explicitly occupied and busy offsets are both skipped', () => {
    const checkout = '/tmp/checkout-b';
    const start = preferredPortSlot(checkout);
    const first = E2E_PORT_OFFSETS[start];
    const second = E2E_PORT_OFFSETS[(start + 1) % E2E_PORT_SLOTS];
    const third = E2E_PORT_OFFSETS[(start + 2) % E2E_PORT_SLOTS];
    expect(
      selectPortOffset({
        checkout,
        occupiedOffsets: [first],
        isAvailable: (offset) => offset !== second,
      }),
    ).toBe(third);
  });
});

describe('persistent port allocation', () => {
  test('reuses a checkout record and gives a different checkout a distinct slot', () => {
    const { records, store } = makeMemoryPortStore();
    const first = allocatePortOffset({ checkout: '/tmp/one', store });
    const repeated = allocatePortOffset({ checkout: '/tmp/one', store });
    const second = allocatePortOffset({ checkout: '/tmp/two', store });

    expect(repeated).toBe(first);
    expect(second).not.toBe(first);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.checkout)).toEqual(['/tmp/one', '/tmp/two']);
  });

  test('ignores a removed checkout when choosing an occupied slot', () => {
    const { records, store } = makeMemoryPortStore();
    const checkout = '/tmp/current-checkout';
    const preferred = portOffsetsForSlots()[preferredPortSlot(checkout)];
    records.push({
      checkout: '/tmp/removed-checkout',
      offset: preferred,
      allocatedAt: '2026-01-01',
    });
    store.checkoutExists = (path) => path !== '/tmp/removed-checkout';

    expect(allocatePortOffset({ checkout, store })).toBe(preferred);
  });

  test('does not choose a slot whose complete service port set is busy', () => {
    const { store } = makeMemoryPortStore();
    const checkout = '/tmp/busy';
    const preferred = portOffsetsForSlots()[preferredPortSlot(checkout)];
    const preferredPorts = new Set(portsForOffset(preferred));
    const selected = allocatePortOffset({
      checkout,
      store,
      isPortAvailable: (port) => !preferredPorts.has(port),
    });

    expect(selected).not.toBe(preferred);
  });

  test('writes one durable JSON record and releases the cross-process lock', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aikami-e2e-ports-'));
    try {
      const first = allocatePortOffset({
        checkout: join(directory, 'checkout'),
        allocationDir: directory,
        isPortAvailable: () => true,
      });
      const second = allocatePortOffset({
        checkout: join(directory, 'checkout'),
        allocationDir: directory,
        isPortAvailable: () => true,
      });
      expect(second).toBe(first);
      expect(readdirSync(directory).filter((name) => name.endsWith('.json'))).toHaveLength(1);
      expect(readdirSync(directory)).not.toContain('.allocation.lock');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('the exported lock serializes nested callers without leaving a lock file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aikami-e2e-lock-'));
    try {
      const value = withPortAllocationLock(directory, () => 'allocated');
      expect(value).toBe('allocated');
      expect(readdirSync(directory)).not.toContain('.allocation.lock');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('keeps a recent malformed lock and reclaims it after the stale threshold', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aikami-e2e-lock-'));
    const lockPath = join(directory, '.allocation.lock');
    try {
      writeFileSync(lockPath, '{incomplete');
      let time = Date.now();
      const now = () => (time += 1_000);
      expect(() => withPortAllocationLock(directory, () => 'unexpected', now)).toThrow(/Timed out/);
      expect(existsSync(lockPath)).toBe(true);

      const stale = new Date(Date.now() - 31_000);
      utimesSync(lockPath, stale, stale);
      expect(withPortAllocationLock(directory, () => 'reclaimed')).toBe('reclaimed');
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('port offset resolution', () => {
  test('the primary checkout always resolves to zero without an override', () => {
    expect(
      resolveE2EPortOffset({
        env: {},
        checkoutRoot: '/repo/primary',
        isLinkedWorktree: () => false,
      }),
    ).toBe(0);
  });

  test('an explicit non-zero environment override is authoritative', () => {
    expect(
      resolveE2EPortOffset({
        env: { PUBLIC_EMULATOR_PORT_OFFSET: '198' },
        checkoutRoot: '/repo/linked',
        isLinkedWorktree: () => true,
      }),
    ).toBe(198);
    expect(parseExplicitPortOffset('0')).toBe(0);
  });

  test('an inherited zero cannot bypass linked-worktree allocation', () => {
    const { records, store } = makeMemoryPortStore();
    const offset = resolveE2EPortOffset({
      env: { PUBLIC_EMULATOR_PORT_OFFSET: '0' },
      checkoutRoot: '/repo/linked-inherited-zero',
      isLinkedWorktree: () => true,
      store,
    });

    expect(offset).toBeGreaterThan(0);
    expect(records).toHaveLength(1);
    expect(records[0]?.checkout).toBe('/repo/linked-inherited-zero');
  });

  test('an explicitly authorized zero remains available to linked callers', () => {
    expect(
      resolveE2EPortOffset({
        env: { PUBLIC_EMULATOR_PORT_OFFSET: '0' },
        checkoutRoot: '/repo/linked-explicit-zero',
        isLinkedWorktree: () => true,
        allowExplicitZero: true,
      }),
    ).toBe(0);
  });

  test('rejects malformed explicit offsets rather than producing NaN ports', () => {
    expect(() => parseExplicitPortOffset('not-a-number')).toThrow(/non-negative integer/);
    expect(() => parseExplicitPortOffset('-1')).toThrow(/non-negative integer/);
  });

  test('linked worktrees use the injected durable allocator', () => {
    const { store } = makeMemoryPortStore();
    const offset = resolveE2EPortOffset({
      env: {},
      checkoutRoot: '/repo/linked',
      allocationDir: '/tmp/injected-e2e-ports',
      isLinkedWorktree: () => true,
      store,
    });
    expect(E2E_PORT_OFFSETS).toContain(offset);
  });

  test('the production allocator has a durable home and a fail-closed probe', () => {
    expect(E2E_PORT_ALLOCATION_DIR).toContain('.herdr/aikami/e2e-port-allocations');
    expect(isPortAvailableSync(0)).toBe(false);
  });
});

const evidenceIdentity = (root: string, commit: string): EvidenceIdentity => ({
  root,
  commit,
  branch: 'task/c-560',
  statusFingerprint: sha256Hex(`${root}:${commit}`),
  dirty: false,
});

const evidenceOrigin = (role: EvidenceOrigin['role'], port: number): EvidenceOrigin => ({
  role,
  clientUrl: `http://127.0.0.1:${port}`,
  assetOrigin: `http://127.0.0.1:${port + 100}`,
});

const loadedContentIdentity = (
  version: string,
  digestCharacter: string,
): ContentIdentitySnapshot => ({
  packId: 'emberwatch',
  packName: 'Emberwatch: The Fading Ward',
  version,
  updatedAt: '2026-09-18T00:00:00.000Z',
  manifestSha256: digestCharacter.repeat(64),
  atlasTextureUrl: '/game-data/sprites/tilesets/atlas.webp',
  atlasSpritesheetUrl: '/game-data/sprites/tilesets/atlas.json',
  propAtlases: [],
  provenanceSource: 'generated:gpt',
});

const evidenceCapture = (lane: 'before' | 'after'): EvidenceCaptureRecord => ({
  lane,
  id: 'hut-front',
  label: 'Hut front',
  file: `${lane}/hut-front.png`,
  clientUrl: `http://127.0.0.1:${lane === 'before' ? 5274 : 5275}`,
  assetOrigin: `http://127.0.0.1:${lane === 'before' ? 8788 : 8789}`,
  originRole: lane === 'before' ? 'published' : 'candidate',
  root: lane === 'before' ? '/before' : '/after',
  commit: lane === 'before' ? 'a'.repeat(40) : 'b'.repeat(40),
  branch: 'task/c-560',
  statusFingerprint: sha256Hex(lane),
  mapId: 'village',
  requestedCell: '54,11',
  actualPlayerCell: '54,11',
  actualCameraCell: '54,11',
  renderer: 'webgl',
  viewport: { width: 1280, height: 720 },
  pixelWidth: 1280,
  pixelHeight: 720,
  entityTextureFingerprint: sha256Hex(`${lane}:textures`),
  sha256: sha256Hex(`${lane}:png`),
});

describe('persistent evidence records', () => {
  test('requires each capture to request its own origin without crossing asset lanes', () => {
    const origins = {
      lane: 'before' as const,
      assetOrigin: 'http://127.0.0.1:8788',
      otherAssetOrigin: 'http://127.0.0.1:8789',
    };
    expect(() =>
      validateEvidenceLaneRequests({
        ...origins,
        requestUrls: ['http://127.0.0.1:5274/game'],
      }),
    ).toThrow(/made no requests/);
    expect(() =>
      validateEvidenceLaneRequests({
        ...origins,
        requestUrls: [
          'http://127.0.0.1:8788/seed/asset_seed.json',
          'http://127.0.0.1:8789/assets/a/file.png',
        ],
      }),
    ).toThrow(/requested seed or assets/);
    expect(() =>
      validateEvidenceLaneRequests({
        ...origins,
        requestUrls: ['http://127.0.0.1:8788/assets/a/file.png'],
      }),
    ).not.toThrow();
  });

  test('hashes and renders deterministic checksum records', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    const records = createChecksumRecords([
      { path: 'z.txt', bytes: 'z' },
      { path: 'before/a.png', bytes: 'a' },
    ]);
    expect(records.map((record) => record.path)).toEqual(['before/a.png', 'z.txt']);
    expect(renderChecksumsFile(records)).toBe(
      `${records[0].sha256}  before/a.png\n${records[1].sha256}  z.txt\n`,
    );
    expect(() =>
      createChecksumRecords([
        { path: 'before/a.png', bytes: 'a' },
        { path: 'before/a.png', bytes: 'b' },
      ]),
    ).toThrow(/Duplicate/);
    expect(() => createChecksumRecord({ path: '../escape', bytes: 'x' })).toThrow(/relative/);
  });

  test('normalizes loopback origins and rejects remote origins by default', () => {
    expect(
      normalizeEvidenceOrigin({
        value: 'http://127.0.0.1:8788/',
        flagName: '--before-origin',
        allowRemote: false,
      }),
    ).toBe('http://127.0.0.1:8788');
    expect(() =>
      normalizeEvidenceOrigin({
        value: 'https://assets.example',
        flagName: '--after-origin',
        allowRemote: false,
      }),
    ).toThrow(/loopback/);
  });

  test('pairs records and publishes a complete manifest and index', () => {
    const before = evidenceCapture('before');
    const after = evidenceCapture('after');
    expect(pairEvidenceCaptures([after, before])).toHaveLength(1);
    expect(() => pairEvidenceCaptures([before])).toThrow(/incomplete/);
    const manifest = createEvidenceManifest({
      contract: 'C-560',
      id: 'hut-front',
      label: 'C-560 paired evidence',
      capturedAt: '2026-09-25T00:00:00.000Z',
      command: 'bun run --cwd apps/e2e capture:evidence --contract C-560',
      cwd: '/repo',
      identities: {
        before: evidenceIdentity('/before', 'a'.repeat(40)),
        after: evidenceIdentity('/after', 'b'.repeat(40)),
      },
      origins: {
        before: evidenceOrigin('published', 5274),
        after: evidenceOrigin('candidate', 5275),
      },
      captures: [before, after],
      loadedContent: {
        before: loadedContentIdentity('5.0.0', 'a'),
        after: loadedContentIdentity('5.0.1', 'b'),
      },
      entityTexturePolicy: 'visible-entity-textures-v2',
    });
    expect(manifest.status).toBe('complete');
    expect(manifest.renderer).toBe('webgl');
    expect(manifest.entityTextureGuard).toEqual({
      policy: 'visible-entity-textures-v2',
      status: 'passed',
    });
    expect(manifest.published.root).toBe('/before');
    expect(manifest.candidate.root).toBe('/after');
    expect(manifest.loadedContent.after?.manifestSha256).toBe('b'.repeat(64));
    const index = renderEvidenceIndex(manifest);
    expect(index).toContain('# C-560 evidence');
    expect(index).toContain('before/hut-front.png');
    expect(index).toContain('after/hut-front.png');
    expect(index).toContain('montage.png');
    expect(index).toContain('checksums.sha256');
    expect(index).toContain('Loaded content identity');
    expect(index).toContain('5.0.1');
    expect(index).toContain('b'.repeat(64));
  });

  test('computes a deterministic two-cell montage layout', () => {
    const layout = createMontageLayout(2);
    expect(layout.columns).toBe(2);
    expect(layout.cells[1]?.left).toBe(layout.cellWidth);
    expect(
      buildMontageLayout(4, {
        columns: 2,
        cellWidth: 100,
        imageHeight: 60,
        labelHeight: 20,
        gap: 5,
      }).rows,
    ).toBe(2);
    expect(() => createMontageLayout(0)).toThrow(/item count/);
  });
});
