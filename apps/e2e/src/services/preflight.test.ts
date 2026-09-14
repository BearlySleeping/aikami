// apps/e2e/src/services/preflight.test.ts
// Unit tests for the per-run preflight orchestration — every process/env
// effect goes through the injectable PreflightIo, so these run hermetically.

import { expect, test } from 'bun:test';

import type { PreflightIo } from './preflight';
import { runPreflight } from './preflight';
import { FALLBACK_BUILD_ENV } from './service_map';

// ── Fake io ──────────────────────────────────────────────────

type SyncCall = {
  command: string;
  args: string[];
  options: { cwd: string; env?: Record<string, string> };
};

type SpawnCall = {
  command: string;
  cwd: string;
  env: Record<string, string>;
  logFile: string;
};

const makeIo = (
  stateOverrides: Partial<{
    probeSequence: boolean[];
    herdrStatus: number;
    fileExistsResult: boolean;
  }> = {},
  ioOverrides: Partial<PreflightIo> = {},
) => {
  const state = {
    syncCalls: [] as SyncCall[],
    spawns: [] as SpawnCall[],
    probes: 0,
    clock: 0,
    // Scripted probe results consumed in order; false forever once exhausted.
    probeSequence: [] as boolean[],
    herdrStatus: 1, // herdr absent by default
    fileExistsResult: true,
    ...stateOverrides,
  };
  const io: PreflightIo = {
    probe: async () => {
      state.probes += 1;
      return state.probeSequence.shift() ?? false;
    },
    runSync: (command, args, options) => {
      state.syncCalls.push({ command, args, options });
      return {
        status: command === 'herdr' ? state.herdrStatus : 0,
        stdout: '',
        stderr: '',
      };
    },
    spawnDetached: (command, _args, options) => {
      state.spawns.push({ command, cwd: options.cwd, env: options.env, logFile: options.logFile });
      return 4000 + state.spawns.length;
    },
    fileExists: () => state.fileExistsResult,
    linkedWorktree: () => false,
    gitTopLevel: () => '/repo',
    env: (key) => process.env[key],
    now: () => state.clock,
    sleep: async () => {
      state.clock += 10_000;
    },
    log: () => {},
    ...ioOverrides,
  };
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
  expect(startCall?.args).toEqual(['run', 'herdr:start', 'client,hub']);
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
  expect(startCall?.args).toEqual(['run', 'herdr:start', 'client,hub']);
  expect(state.spawns).toEqual([
    {
      command: 'bun run dev:emulator',
      cwd: '/repo/apps/frontend/client',
      env: {
        PORT: '5275',
        PUBLIC_MUTE_AUDIO: '1',
        PUBLIC_MODE: 'emulator',
        PUBLIC_COMBAT_LLM_AGENTS: '1',
      },
      logFile: expect.stringContaining('client-llm.log'),
    },
  ]);
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

test('without herdr: missing site artifact triggers the moon build with CI env', async () => {
  const { state, io } = makeIo(
    { probeSequence: [false, true] },
    { fileExists: (path) => !path.includes('apps/frontend/site/dist') },
  );
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
  expect(state.spawns).toEqual([
    {
      command: 'bun run preview',
      cwd: '/repo/apps/frontend/site',
      env: { PORT: '5280' },
      logFile: expect.stringContaining('site.log'),
    },
  ]);
});

test('without herdr: an already-built artifact is served, not rebuilt', async () => {
  const { state, io } = makeIo({ probeSequence: [false, true] });
  const result = await runPreflight({
    requestedProjects: ['site-chromium'],
    io,
    readyTimeoutMs: 5000,
  });
  expect(result.started).toEqual(['site']);
  expect(moonRun(state)).toBeUndefined();
  expect(state.spawns[0]?.command).toBe('bun run preview');
});

test('game-only fallback starts a dev client and never builds', async () => {
  const { state, io } = makeIo({ fileExistsResult: false, probeSequence: [false, true] });
  const result = await runPreflight({ requestedProjects: ['game'], io, readyTimeoutMs: 5000 });
  expect(result.started).toEqual(['client']);
  expect(moonRun(state)).toBeUndefined();
  expect(state.spawns).toEqual([
    {
      command: 'bun run dev:emulator',
      cwd: '/repo/apps/frontend/client',
      env: { PORT: '5274', PUBLIC_MUTE_AUDIO: '1', PUBLIC_MODE: 'emulator' },
      logFile: expect.stringContaining('client.log'),
    },
  ]);
});

// ── Readiness ────────────────────────────────────────────────

test('a server that never becomes ready fails with its url and log path', async () => {
  const { state, io } = makeIo({}, { probe: async () => false });
  await expect(
    runPreflight({ requestedProjects: ['game'], io, readyTimeoutMs: 3000 }),
  ).rejects.toThrow(/timed out waiting for client \(game\/PWA\) at http:\/\/localhost:5274/);
  expect(state.spawns).toHaveLength(1);
});
