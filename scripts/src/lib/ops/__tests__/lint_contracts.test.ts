// scripts/src/lib/ops/__tests__/lint_contracts.test.ts
//
// Tests for the production-path lint rule (C-485 AC-1) and related
// helpers: classifyProductionPath, hasWholeContractOptOut, parseTableRows,
// checkProductionPath, and PRODUCTION_PATH_LEGACY_EXEMPTIONS.

import { describe, expect, test } from 'bun:test';
import {
  type ContractInfo,
  checkProductionPath,
  classifyProductionPath,
  hasWholeContractOptOut,
  PRODUCTION_PATH_LEGACY_EXEMPTIONS,
  parseTableRows,
} from '../lint_contracts.ts';

// ── Helpers ──────────────────────────────────────────────────

const makeContract = (overrides: Partial<ContractInfo> & { content: string }): ContractInfo => ({
  filename: 'C-999-test.md',
  id: 'C-999',
  status: 'approved',
  version: 2,
  archived: false,
  contractType: 'full',
  ...overrides,
});

// ── classifyProductionPath (format only, no resolution) ──────

describe('classifyProductionPath', () => {
  test('empty cell returns error', () => {
    expect(classifyProductionPath('')).toBe('Empty Production Path cell');
  });

  test('whitespace-only cell returns error', () => {
    expect(classifyProductionPath('   ')).toBe('Empty Production Path cell');
  });

  test('bare N/A returns error', () => {
    const result = classifyProductionPath('N/A');
    expect(result).toMatch(/Bare N\/A/);
  });

  test('lowercase n/a returns error', () => {
    const result = classifyProductionPath('n/a');
    expect(result).toMatch(/Bare N\/A/);
  });

  test('template placeholder returns error', () => {
    const result = classifyProductionPath('{N/A | /game/...}');
    expect(result).toMatch(/Template placeholder/);
  });

  test('TBD marker returns error', () => {
    const result = classifyProductionPath('TBD');
    expect(result).toMatch(/TBD/);
  });

  test('dash-only returns error', () => {
    const result = classifyProductionPath('-');
    expect(result).toMatch(/Invalid/);
  });

  test('em-dash only returns error', () => {
    const result = classifyProductionPath('\u2014');
    expect(result).toMatch(/Invalid/);
  });

  test('N/A with reason at row level returns error', () => {
    const result = classifyProductionPath('N/A \u2014 no UI for this AC');
    expect(result).toMatch(/Row-level N\/A/);
  });

  test('valid route format returns null', () => {
    expect(classifyProductionPath('/game/party')).toBeNull();
  });

  test('valid file.ts#symbol format returns null', () => {
    expect(
      classifyProductionPath(
        'apps/frontend/client/src/lib/services/foo_service.svelte.ts#fooMethod',
      ),
    ).toBeNull();
  });

  test('valid tooling command format returns null', () => {
    expect(classifyProductionPath('tooling: `bun run scripts:guard`')).toBeNull();
  });

  test('named component reference returns null', () => {
    expect(classifyProductionPath('PartyView')).toBeNull();
  });
});

// ── hasWholeContractOptOut ───────────────────────────────────

describe('hasWholeContractOptOut', () => {
  test('detects exact opt-out in Metadata', () => {
    const content = [
      '---',
      'id: C-999',
      '---',
      '',
      '## Metadata',
      '| Field | Value |',
      '|---|---|',
      '| **Production Surface** | none \u2014 this contract has no UI surface; it is a static analysis rule only |',
      '',
      '## Acceptance Criteria',
      '...',
    ].join('\n');
    expect(hasWholeContractOptOut(makeContract({ content }))).toBe(true);
  });

  test('rejects missing opt-out', () => {
    const content = [
      '---',
      'id: C-999',
      '---',
      '',
      '## Metadata',
      '| Field | Value |',
      '|---|---|',
      '| **Status** | approved |',
      '',
      '## Acceptance Criteria',
      '...',
    ].join('\n');
    expect(hasWholeContractOptOut(makeContract({ content }))).toBe(false);
  });

  test('rejects opt-out with empty reason', () => {
    const content = [
      '---',
      'id: C-999',
      '---',
      '',
      '## Metadata',
      '| Field | Value |',
      '|---|---|',
      '| **Production Surface** | none \u2014 |',
      '',
      '## Acceptance Criteria',
      '...',
    ].join('\n');
    expect(hasWholeContractOptOut(makeContract({ content }))).toBe(false);
  });
});

// ── parseTableRows ──────────────────────────────────────────

describe('parseTableRows', () => {
  const sampleTable = [
    '| AC | Test Level | Required Artifact | Production Path | Evidence |',
    '|---|---|---|---|---|',
    '| AC-1 | Unit | `test.ts` | /game/party | Filled during verification |',
    '| AC-2 | E2E | `e2e.spec.ts` | /game/map | Filled during verification |',
  ].join('\n');

  test('parses standard table into rows', () => {
    const rows = parseTableRows(sampleTable);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('AC-1');
    expect(rows[0][1]).toBe('Unit');
    expect(rows[0][2]).toBe('`test.ts`');
    expect(rows[0][3]).toBe('/game/party');
    expect(rows[1][0]).toBe('AC-2');
    expect(rows[1][3]).toBe('/game/map');
  });

  test('handles escaped pipes in cells', () => {
    const table = [
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | `test.ts` | tooling: `bun run test \\|\\| echo ok` | Filled |',
    ].join('\n');
    const rows = parseTableRows(table);
    expect(rows).toHaveLength(1);
    const pathCell = rows[0][3] ?? '';
    expect(pathCell).toContain('tooling:');
  });

  test('returns empty array for fewer than 3 lines', () => {
    expect(parseTableRows('| header |')).toEqual([]);
  });

  test('handles trailing whitespace on rows', () => {
    const table = [
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | `test.ts` | /game/party | Filled |   ',
    ].join('\n');
    const rows = parseTableRows(table);
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('/game/party');
  });
});

// ── checkProductionPath ─────────────────────────────────────

describe('checkProductionPath', () => {
  test('skips draft contracts', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | test.ts |  | Filled |',
    ].join('\n');
    const info = makeContract({ status: 'draft', content });
    expect(checkProductionPath(info)).toEqual([]);
  });

  test('skips legacy exemption contracts (C-456)', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | test.ts |  | Filled |',
    ].join('\n');
    const info = makeContract({
      id: 'C-456',
      filename: 'C-456-group-chat-and-systemic-npc-interactions.md',
      content,
    });
    expect(checkProductionPath(info)).toEqual([]);
  });

  test('skips legacy exemption contracts (C-460)', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | test.ts |  | Filled |',
    ].join('\n');
    const info = makeContract({
      id: 'C-460',
      filename: 'C-460-npc-behavioral-autonomy-layer.md',
      content,
    });
    expect(checkProductionPath(info)).toEqual([]);
  });

  test('fails approved contract with empty production path cells', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | `test.ts` |  | Filled during verification |',
      '| AC-2 | E2E | `e2e.spec.ts` | N/A | Filled during verification |',
    ].join('\n');
    const info = makeContract({ content });
    const issues = checkProductionPath(info);
    // One row-level error per invalid row + one overall error
    expect(issues).toHaveLength(3);
    for (const issue of issues) {
      expect(issue.rule).toBe('production-path');
      expect(issue.severity).toBe('error');
    }
  });

  test('fails approved contract with bare N/A cells', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | `test.ts` | N/A | Filled |',
    ].join('\n');
    const info = makeContract({ content });
    const issues = checkProductionPath(info);
    // One row-level error for N/A + one overall error
    expect(issues).toHaveLength(2);
  });

  test('passes with tooling command reference (bun run test exists in package.json)', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | `test.ts` | tooling: `bun run test` | Filled |',
    ].join('\n');
    const info = makeContract({ content });
    const issues = checkProductionPath(info);
    expect(issues).toHaveLength(0);
  });

  test('resolves a Moon task inherited by the scripts project', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Integration | `guard.test.ts` | tooling: `moon run scripts:guard` | Filled |',
    ].join('\n');

    expect(checkProductionPath(makeContract({ content }))).toHaveLength(0);
  });

  test('rejects a Moon task that is not inherited by the named project', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Integration | `guard.test.ts` | tooling: `moon run client:guard` | Filled |',
    ].join('\n');

    // One row-level error + one overall error
    expect(checkProductionPath(makeContract({ content }))).toHaveLength(2);
  });

  test('accepts whole-contract opt-out even with empty matrix cells', () => {
    const content = [
      '## Metadata',
      '| Field | Value |',
      '|---|---|',
      '| **Production Surface** | none \u2014 this contract has no UI; it is a tooling-only contract |',
      '',
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | `test.ts` |  | Filled |',
    ].join('\n');
    const info = makeContract({ content });
    const issues = checkProductionPath(info);
    expect(issues).toHaveLength(0);
  });

  test('fails a non-exempt approved contract with unresolvable route', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Unit | `test.ts` | /nonexistent/route/xyz | Filled |',
    ].join('\n');
    const info = makeContract({ content });
    const issues = checkProductionPath(info);
    // One row-level error + one overall error
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain('Route not found');
    expect(issues[1].message).toContain('No AC has a valid Production Path');
  });

  test('handles thin contract with no production path in Verification', () => {
    const content = [
      '## Acceptance Criteria',
      '',
      '### AC-1: Some feature',
      '**Given** precondition',
      '**When** action',
      '**Then** outcome',
      '',
      '**Verification**: `bun run test:unit`',
      '',
      '### AC-2: Another feature',
      '**Given** precondition',
      '**When** action',
      '**Then** outcome',
      '',
      '**Verification**: some prose description without a path',
    ].join('\n');
    const info = makeContract({ contractType: 'thin', content });
    const issues = checkProductionPath(info);
    // Neither AC has a resolvable production path (bare backtick command without
    // `tooling:` prefix does not resolve) → two AC errors + one overall
    expect(issues).toHaveLength(3);
    expect(issues[0].message).toContain('AC-1');
    expect(issues[1].message).toContain('AC-2');
    expect(issues[2].message).toContain('No AC has a production path');
  });

  test('passes thin contract with tooling in Verification', () => {
    const content = [
      '## Acceptance Criteria',
      '',
      '### AC-1: Some feature',
      '**Given** precondition',
      '**When** action',
      '**Then** outcome',
      '',
      '**Verification**: tooling: `bun run test`',
      '',
      '### AC-2: Another feature',
      '**Given** precondition',
      '**When** action',
      '**Then** outcome',
      '',
      '**Verification**: some prose',
    ].join('\n');
    const info = makeContract({ contractType: 'thin', content });
    const issues = checkProductionPath(info);
    // AC-1 resolves but AC-2 does not → one per-AC error, no overall (hasValidPath=true)
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('AC-2');
  });

  test('rejects a thin-contract tooling command with no matching script', () => {
    const content = [
      '## Acceptance Criteria',
      '',
      '### AC-1: Some feature',
      '**Verification**: tooling: `bun run definitely-not-a-script`',
    ].join('\n');
    const info = makeContract({ contractType: 'thin', content });

    // One AC-level error + one overall error
    expect(checkProductionPath(info)).toHaveLength(2);
  });

  test('accepts a route followed by a description', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | E2E | `game.spec.ts` | /game (party screen) | Filled |',
    ].join('\n');

    expect(checkProductionPath(makeContract({ content }))).toHaveLength(0);
  });

  test('accepts a code-formatted root route followed by a description', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | E2E | `start.spec.ts` | `/` (start menu) | Filled |',
    ].join('\n');

    expect(checkProductionPath(makeContract({ content }))).toHaveLength(0);
  });

  test('resolves routes nested beneath transparent route groups', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | E2E | `sandbox.spec.ts` | /dev/sandbox | Filled |',
    ].join('\n');

    expect(checkProductionPath(makeContract({ content }))).toHaveLength(0);
  });

  test('resolves an exported async function', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | Integration | `character_importer.test.ts` | apps/frontend/client/src/lib/views/utils/character_importer.ts#parsePngCard | Filled |',
    ].join('\n');

    expect(checkProductionPath(makeContract({ content }))).toHaveLength(0);
  });

  test('resolves a named component against its source file', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | E2E | `chat.spec.ts` | ChatView | Filled |',
    ].join('\n');

    expect(checkProductionPath(makeContract({ content }))).toHaveLength(0);
  });

  test('rejects a named component without a source file', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| AC-1 | E2E | `missing.spec.ts` | DefinitelyMissingView | Filled |',
    ].join('\n');

    const issues = checkProductionPath(makeContract({ content }));
    // One row-level error + one overall error
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain('Component not found');
    expect(issues[1].message).toContain('No AC has a valid Production Path');
  });

  test('attributes an empty unnamed row by row index', () => {
    const content = [
      '**Evidence Matrix**:',
      '| AC | Test Level | Required Artifact | Production Path | Evidence |',
      '|---|---|---|---|---|',
      '| | | | | |',
    ].join('\n');

    const issues = checkProductionPath(makeContract({ content }));
    // One row-level error (empty cell) + one overall error
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain('row 1: Empty Production Path cell');
    expect(issues[1].message).toContain('No AC has a valid Production Path');
  });
});

// ── PRODUCTION_PATH_LEGACY_EXEMPTIONS ───────────────────────

describe('PRODUCTION_PATH_LEGACY_EXEMPTIONS', () => {
  test('contains C-456 through C-460', () => {
    for (const id of ['C-456', 'C-457', 'C-458', 'C-459', 'C-460']) {
      expect(PRODUCTION_PATH_LEGACY_EXEMPTIONS.has(id)).toBe(true);
    }
  });

  test('does not contain unrelated contracts', () => {
    expect(PRODUCTION_PATH_LEGACY_EXEMPTIONS.has('C-485')).toBe(false);
    expect(PRODUCTION_PATH_LEGACY_EXEMPTIONS.has('C-001')).toBe(false);
  });
});
