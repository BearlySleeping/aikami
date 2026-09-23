// scripts/src/lib/agents/contract_pipeline/base_health.test.ts
//
// Base-health preflight behaviour. The point of `checkBaseHealth` is to
// distinguish an INHERITED red guard (already failing on the base the run
// branched from) from one this run caused — and to record the former as an
// infra issue the review captain is told not to fix.
//
// The runner is injectable (see BaseHealthRunner), so none of this shells out.

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInfraIssues } from '../../ops/infra_report.ts';
import { checkBaseHealth } from './base_health.ts';

describe('checkBaseHealth', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'base-health-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('reports unavailable when the runner is not present in the tree', () => {
    const result = checkBaseHealth({ cwd, runnerExists: () => false });

    expect(result.outcome).toBe('unavailable');
    expect(result.output).toContain('not present in this tree');
    // No runner was ever invoked, so nothing was recorded.
    expect(readInfraIssues(cwd)).toEqual([]);
  });

  it('reports unavailable — never green — when the runner cannot be spawned', () => {
    const result = checkBaseHealth({
      cwd,
      runnerExists: () => true,
      runner: () => ({ status: null, output: 'ENOENT', spawnFailed: true }),
    });

    expect(result.outcome).toBe('unavailable');
    expect(result.output).toBe('ENOENT');
    // An infrastructure failure is not a red base; nothing to report as an issue.
    expect(readInfraIssues(cwd)).toEqual([]);
  });

  it('reports green when the guards pass on the base', () => {
    const result = checkBaseHealth({
      cwd,
      runnerExists: () => true,
      runner: () => ({ status: 0, output: '✅ 10 structural guards passed', spawnFailed: false }),
    });

    expect(result.outcome).toBe('green');
    expect(readInfraIssues(cwd)).toEqual([]);
  });

  it('reports red and records an infra issue when the base is already failing', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = checkBaseHealth({
        cwd,
        runId: 'run-abc',
        runnerExists: () => true,
        runner: () => ({
          status: 1,
          output: '### ❌ Guard: source file size\n→ Fix: extract a cohesive responsibility',
          spawnFailed: false,
        }),
      });

      expect(result.outcome).toBe('red');
      expect(result.output).toContain('source file size');
      // The operator-facing warning names the inherited failure.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('BASE IS RED'));

      const issues = readInfraIssues(cwd);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.component).toBe('base_health');
      expect(issues[0]?.operation).toBe('structural guards on base');
      expect(issues[0]?.runId).toBe('run-abc');
      expect(issues[0]?.error).toContain('source file size');
    } finally {
      warn.mockRestore();
    }
  });

  it('carries the runner output through a red verdict unchanged', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostics = '### ❌ Guard: type safety\nT1 `as unknown as X` — 1 found';
    try {
      const result = checkBaseHealth({
        cwd,
        runnerExists: () => true,
        runner: () => ({ status: 1, output: diagnostics, spawnFailed: false }),
      });

      expect(result.output).toBe(diagnostics);
    } finally {
      warn.mockRestore();
    }
  });
});
