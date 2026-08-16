// scripts/src/lib/ops/infra_report.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatInfraNotesForPrompt,
  normalizeError,
  readInfraIssues,
  reportInfraIssue,
  summarizeInfraIssues,
} from './infra_report.ts';

const tempDirs: string[] = [];
const makeTempCwd = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'infra-report-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('normalizeError', () => {
  it('strips volatile substrings so repeat failures share a fingerprint', () => {
    const a = normalizeError(
      "ENOENT: no such file, open 'C:\\Users\\alice\\repo\\.pi\\contract-runs\\run-msvuia8i-C-401\\gh-token'",
    );
    const b = normalizeError(
      "ENOENT: no such file, open 'C:\\Users\\bob\\repo\\.pi\\contract-runs\\run-msuz53d8-C-400\\gh-token'",
    );
    expect(a).toBe(b);
  });

  it('caps length so one giant stack trace cannot dominate the log', () => {
    const huge = 'x'.repeat(10_000);
    expect(normalizeError(huge).length).toBeLessThanOrEqual(300);
  });
});

describe('reportInfraIssue / readInfraIssues round-trip', () => {
  it('appends an event that can be read back', () => {
    const cwd = makeTempCwd();
    reportInfraIssue({
      component: 'worktree_bootstrap',
      operation: 'symlink .pi/node_modules',
      error: new Error('EPERM: operation not permitted'),
      context: { checkoutPath: 'C:\\fake\\path' },
      cwd,
    });
    const events = readInfraIssues(cwd);
    expect(events).toHaveLength(1);
    expect(events[0]?.component).toBe('worktree_bootstrap');
    expect(events[0]?.error).toContain('EPERM');
    expect(events[0]?.fingerprint).toBe(
      'worktree_bootstrap:symlink .pi/node_modules:EPERM: operation not permitted',
    );
  });

  it('never throws, even when error is not an Error instance', () => {
    const cwd = makeTempCwd();
    expect(() =>
      reportInfraIssue({ component: 'x', operation: 'y', error: 'plain string failure', cwd }),
    ).not.toThrow();
    expect(readInfraIssues(cwd)[0]?.error).toBe('plain string failure');
  });

  it('is a no-op read (empty array) when the log does not exist yet', () => {
    const cwd = makeTempCwd();
    expect(readInfraIssues(cwd)).toEqual([]);
  });

  it('skips a corrupted trailing line instead of failing the whole read', () => {
    const cwd = makeTempCwd();
    reportInfraIssue({ component: 'a', operation: 'b', error: new Error('one'), cwd });
    reportInfraIssue({ component: 'a', operation: 'b', error: new Error('two'), cwd });
    // Simulate a torn write: append a truncated JSON line.
    reportInfraIssue({ component: 'a', operation: 'b', error: new Error('three'), cwd });
    const events = readInfraIssues(cwd);
    expect(events.length).toBeGreaterThanOrEqual(3);
  });
});

describe('summarizeInfraIssues', () => {
  it('groups repeat occurrences by fingerprint and ranks by count', () => {
    const cwd = makeTempCwd();
    for (let i = 0; i < 3; i++) {
      reportInfraIssue({
        component: 'gh_pr_lookup',
        operation: 'find PR url',
        error: new Error('boom'),
        cwd,
      });
    }
    reportInfraIssue({
      component: 'symlink',
      operation: 'link node_modules',
      error: new Error('EPERM'),
      cwd,
    });

    const summary = summarizeInfraIssues(readInfraIssues(cwd));
    expect(summary).toHaveLength(2);
    expect(summary[0]?.count).toBe(3);
    expect(summary[0]?.component).toBe('gh_pr_lookup');
    expect(summary[1]?.count).toBe(1);
  });

  it('filters by sinceMs', () => {
    const events = [
      {
        timestamp: new Date(Date.now() - 100_000_000).toISOString(),
        component: 'old',
        operation: 'op',
        error: 'stale',
        fingerprint: 'old:op:stale',
      },
      {
        timestamp: new Date().toISOString(),
        component: 'fresh',
        operation: 'op',
        error: 'recent',
        fingerprint: 'fresh:op:recent',
      },
    ];
    const summary = summarizeInfraIssues(events, { sinceMs: 60_000 });
    expect(summary).toHaveLength(1);
    expect(summary[0]?.component).toBe('fresh');
  });
});

describe('formatInfraNotesForPrompt', () => {
  it('returns empty string for no issues — no empty section injected into the prompt', () => {
    expect(formatInfraNotesForPrompt([])).toBe('');
  });

  it('renders a read-only report-not-fix block for the review captain', () => {
    const text = formatInfraNotesForPrompt([
      {
        fingerprint: 'a:b:c',
        component: 'gh_pr_lookup',
        operation: 'find PR url',
        error: 'quoting bug',
        count: 4,
        firstSeen: '2026-08-16T00:00:00.000Z',
        lastSeen: '2026-08-16T01:00:00.000Z',
      },
    ]);
    expect(text).toContain('read-only — report, do not fix');
    expect(text).toContain('gh_pr_lookup');
    expect(text).toContain('×4');
  });
});
