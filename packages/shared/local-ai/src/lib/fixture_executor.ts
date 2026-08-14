// packages/shared/local-ai/src/lib/fixture_executor.ts
//
// Fixture-replay ProbeExecutor: answers every run/readTextFile/statfs call
// from a captured-fixture table with ZERO process spawns. This is the
// adapter that proves the core is host-agnostic (AC-0b) and that a Tauri
// adapter needs no change to @aikami/local-ai.
//
// Fixtures must be captured from real machines (nvidia-smi, rocm-smi,
// vulkaninfo, /proc/meminfo, sysctl, docker info) — see the C-391 Watch
// Points. Hand-written strings drift from reality.

import type { ProbeExecutor, ProbeResult, StatfsResult } from './probe_executor.ts';

export type CommandFixture = {
  readonly command: string;
  readonly args?: readonly string[];
  readonly result: ProbeResult;
};

export type FileFixture = {
  readonly path: string;
  readonly result: ProbeResult;
};

export type StatfsFixture = {
  readonly path: string;
  readonly result: StatfsResult;
};

export type FixtureTable = {
  readonly commands: readonly CommandFixture[];
  readonly files: readonly FileFixture[];
  readonly statfs: readonly StatfsFixture[];
};

/**
 * Structural argument comparison: same length, same value per position.
 * join(' ') is ambiguous (["a b", "c"] and ["a", "b c"] collide), so
 * compare the vectors element-wise.
 */
const sameArgs = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Builds a fixture-replay executor. Every probe returns the matching fixture
 * result; an unmatched probe resolves to a not-found ProbeResult so a
 * missing fixture behaves like a missing binary rather than throwing.
 *
 * @param table — Captured fixtures.
 * @param unmatched — Optional default result for unmatched probes.
 */
export const createFixtureExecutor = (options: {
  readonly table: FixtureTable;
  readonly unmatched?: ProbeResult;
}): ProbeExecutor => {
  const { table, unmatched } = options;
  const fallback: ProbeResult = unmatched ?? {
    ok: false,
    reason: 'not-found',
    detail: 'no fixture for this probe',
  };

  return {
    async run(command, args) {
      const fixture = table.commands.find(
        (entry) => entry.command === command && sameArgs(entry.args ?? [], [...args]),
      );
      return fixture?.result ?? fallback;
    },
    async readTextFile(path) {
      const fixture = table.files.find((entry) => entry.path === path);
      return fixture?.result ?? fallback;
    },
    async statfs(path) {
      const fixture = table.statfs.find((entry) => entry.path === path);
      return fixture?.result ?? { ok: false };
    },
  };
};
