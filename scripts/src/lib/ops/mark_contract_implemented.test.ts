// scripts/src/lib/ops/mark_contract_implemented.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contractIdFromText,
  decideStatusAdvance,
  frontmatterStatusOf,
  hasExecutionReport,
  prNumberOf,
  resolveContracts,
  statusOf,
} from './mark_contract_implemented.ts';

/** Minimal contract file — the four fields this script reads, nothing else. */
const contract = (options: {
  id: string;
  frontmatterStatus?: string | undefined;
  tableStatus: string;
  prNumber?: number | null;
  report?: boolean;
}): string => {
  const { id, frontmatterStatus, tableStatus, prNumber = null, report = false } = options;
  const frontmatter =
    frontmatterStatus === undefined
      ? ''
      : [
          '---',
          `id: ${id}`,
          `status: ${frontmatterStatus}`,
          'github:',
          `  pr_url: ${prNumber === null ? 'null' : `"https://example.test/pull/${prNumber}"`}`,
          `  pr_number: ${prNumber === null ? 'null' : prNumber}`,
          '---',
          '',
        ].join('\n');

  return [
    frontmatter,
    `# Contract ${id}`,
    '',
    '## Metadata',
    '',
    '| Field | Value |',
    '|---|---|',
    `| **Status** | ${tableStatus} |`,
    '',
    report ? '## Execution Report\n\nBuilt it.\n' : '',
  ].join('\n');
};

describe('field extraction', () => {
  test('reads the table status, the frontmatter status, and the PR number', () => {
    const content = contract({
      id: 'C-439',
      frontmatterStatus: 'approved',
      tableStatus: 'implemented',
      prNumber: 185,
      report: true,
    });
    expect(statusOf(content)).toBe('implemented');
    expect(frontmatterStatusOf(content)).toBe('approved');
    expect(prNumberOf(content)).toBe(185);
    expect(hasExecutionReport(content)).toBe(true);
  });

  test('tolerates the pre-frontmatter contracts (C-011 … C-249)', () => {
    const content = contract({ id: 'C-011', tableStatus: 'completed' });
    expect(statusOf(content)).toBe('completed');
    expect(frontmatterStatusOf(content)).toBeUndefined();
    expect(prNumberOf(content)).toBeUndefined();
  });

  test('a null pr_number does not read as a PR link', () => {
    const content = contract({
      id: 'C-440',
      frontmatterStatus: 'approved',
      tableStatus: 'approved',
    });
    expect(prNumberOf(content)).toBeUndefined();
  });

  test('strips bold markers around the table status', () => {
    expect(statusOf('| **Status** | **approved** |')).toBe('approved');
  });
});

describe('contractIdFromText', () => {
  test('parses PR titles and branch names, case-insensitively', () => {
    expect(contractIdFromText('C-438: Restore PR Checks')).toBe('C-438');
    expect(contractIdFromText('contract-task-c-434-ms1x')).toBe('C-434');
    expect(contractIdFromText('MIG-007: migrate')).toBe('MIG-007');
  });

  test('returns undefined for text with no contract id', () => {
    expect(contractIdFromText('chore: bump deps (#183)')).toBeUndefined();
    expect(contractIdFromText(undefined)).toBeUndefined();
  });
});

describe('decideStatusAdvance', () => {
  test('advances an approved contract that has its Execution Report', () => {
    expect(
      decideStatusAdvance({ status: 'approved', frontmatterStatus: 'approved', hasReport: true }),
    ).toEqual({ action: 'advance', to: 'implemented' });
  });

  test('advances in_progress too', () => {
    expect(
      decideStatusAdvance({
        status: 'in_progress',
        frontmatterStatus: 'in_progress',
        hasReport: true,
      }),
    ).toEqual({ action: 'advance', to: 'implemented' });
  });

  test('refuses to outrun the evidence — no Execution Report, no advance', () => {
    const decision = decideStatusAdvance({
      status: 'approved',
      frontmatterStatus: 'approved',
      hasReport: false,
    });
    expect(decision.action).toBe('skip');
  });

  test('reconciles a lagging frontmatter to the table (the observed drift)', () => {
    expect(
      decideStatusAdvance({
        status: 'implemented',
        frontmatterStatus: 'approved',
        hasReport: true,
      }),
    ).toEqual({ action: 'reconcile', to: 'implemented' });
  });

  test('reconciles up to the table value, not past it', () => {
    expect(
      decideStatusAdvance({ status: 'verified', frontmatterStatus: 'approved', hasReport: true }),
    ).toEqual({ action: 'reconcile', to: 'verified' });
  });

  test('never regresses a frontmatter that is ahead of the table', () => {
    const decision = decideStatusAdvance({
      status: 'implemented',
      frontmatterStatus: 'completed',
      hasReport: true,
    });
    expect(decision.action).toBe('skip');
  });

  test('leaves a draft alone — a merge cannot imply approval', () => {
    const decision = decideStatusAdvance({
      status: 'draft',
      frontmatterStatus: 'draft',
      hasReport: true,
    });
    expect(decision.action).toBe('skip');
  });

  test.each(['blocked', 'superseded', 'verification_failed'])(
    'leaves the %s off-ramp alone',
    (status) => {
      const decision = decideStatusAdvance({
        status,
        frontmatterStatus: status,
        hasReport: true,
      });
      expect(decision.action).toBe('skip');
    },
  );

  test('is idempotent — a re-run over a consistent contract is a no-op', () => {
    const decision = decideStatusAdvance({
      status: 'implemented',
      frontmatterStatus: 'implemented',
      hasReport: true,
    });
    expect(decision.action).toBe('skip');
  });
});

describe('resolveContracts', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'contract-resolve-'));
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (fileName: string, content: string): void => {
    writeFileSync(join(dir, fileName), content);
  };

  test('matches on the frontmatter pr_number', () => {
    write(
      'C-439-card-lorebook-import.md',
      contract({
        id: 'C-439',
        frontmatterStatus: 'approved',
        tableStatus: 'approved',
        prNumber: 185,
      }),
    );
    write(
      'C-440-ci-tooling.md',
      contract({ id: 'C-440', frontmatterStatus: 'approved', tableStatus: 'approved' }),
    );

    const matches = resolveContracts({ contractsDir: dir, prNumber: 185 });
    expect(matches.map((m) => m.id)).toEqual(['C-439']);
    expect(matches[0]?.matchedBy).toContain('pr_number');
  });

  test('matches every contract sharing one PR (a batch contract)', () => {
    write(
      'C-417-p1-polish-batch.md',
      contract({
        id: 'C-417',
        frontmatterStatus: 'approved',
        tableStatus: 'approved',
        prNumber: 42,
      }),
    );
    write(
      'C-418-more-polish.md',
      contract({
        id: 'C-418',
        frontmatterStatus: 'approved',
        tableStatus: 'approved',
        prNumber: 42,
      }),
    );

    const matches = resolveContracts({ contractsDir: dir, prNumber: 42 });
    expect(matches.map((m) => m.id).sort()).toEqual(['C-417', 'C-418']);
  });

  test('falls back to the PR title when nothing is linked', () => {
    write(
      'C-438-restore-pr-checks.md',
      contract({ id: 'C-438', frontmatterStatus: 'approved', tableStatus: 'approved' }),
    );

    const matches = resolveContracts({
      contractsDir: dir,
      prNumber: 999,
      title: 'C-438: Restore PR Checks',
    });
    expect(matches.map((m) => m.id)).toEqual(['C-438']);
    expect(matches[0]?.matchedBy).toContain('PR title');
  });

  test('falls back to the branch name when the title has no id', () => {
    write(
      'C-434-registry-backed-maps.md',
      contract({ id: 'C-434', frontmatterStatus: 'approved', tableStatus: 'approved' }),
    );

    const matches = resolveContracts({
      contractsDir: dir,
      prNumber: 999,
      title: 'feat: registry-backed maps',
      branch: 'contract-task-c-434-ms1x',
    });
    expect(matches.map((m) => m.id)).toEqual(['C-434']);
    expect(matches[0]?.matchedBy).toContain('branch name');
  });

  test('the frontmatter link wins over a conflicting title', () => {
    write(
      'C-439-card-lorebook-import.md',
      contract({
        id: 'C-439',
        frontmatterStatus: 'approved',
        tableStatus: 'approved',
        prNumber: 185,
      }),
    );
    write(
      'C-438-restore-pr-checks.md',
      contract({ id: 'C-438', frontmatterStatus: 'approved', tableStatus: 'approved' }),
    );

    const matches = resolveContracts({
      contractsDir: dir,
      prNumber: 185,
      title: 'C-438: something else entirely',
    });
    expect(matches.map((m) => m.id)).toEqual(['C-439']);
  });

  test('returns nothing for a PR that is not about a contract', () => {
    write(
      'C-438-restore-pr-checks.md',
      contract({ id: 'C-438', frontmatterStatus: 'approved', tableStatus: 'approved' }),
    );

    expect(
      resolveContracts({
        contractsDir: dir,
        prNumber: 183,
        title: 'chore: add workflow refactor',
        branch: 'chore/workflows',
      }),
    ).toEqual([]);
  });

  test('ignores TEMPLATE.md and non-contract files', () => {
    write(
      'TEMPLATE.md',
      contract({ id: 'C-000', frontmatterStatus: 'draft', tableStatus: 'draft' }),
    );
    write('README.md', '# Contracts');
    expect(resolveContracts({ contractsDir: dir, prNumber: 1, title: 'C-000: x' })).toEqual([]);
  });
});
