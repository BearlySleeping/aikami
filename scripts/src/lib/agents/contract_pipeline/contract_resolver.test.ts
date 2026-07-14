// scripts/src/lib/agents/contract_pipeline/contract_resolver.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveContract } from './contract_resolver.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('resolveContract', () => {
  it('resolves an existing contract ID even when it is intentionally absent from TODO.md', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'aikami-contract-resolver-'));
    temporaryDirectories.push(repoRoot);
    const contractsDirectory = join(repoRoot, 'docs/contracts');
    mkdirSync(contractsDirectory, { recursive: true });
    writeFileSync(join(repoRoot, 'docs/TODO.md'), '# Backlog\n');
    writeFileSync(
      join(contractsDirectory, 'C-365-pipeline.md'),
      '# Contract C-365: Pipeline\n\n| **Status** | verified |\n',
    );

    const contract = resolveContract({ target: 'C-365', repoRoot });
    expect(contract.id).toBe('C-365');
    expect(contract.status).toBe('verified');
  });
});
