// scripts/src/lib/agents/contract_pipeline/contract_status.test.ts
//
// C-47x brief, P2: the metadata TABLE is the authoritative status source; the
// YAML frontmatter is the field that drifts. These tests pin the conflict
// detector that makes a disagreement explicit instead of silent.

import { describe, expect, it } from 'bun:test';
import {
  detectStatusConflict,
  parseContractStatus,
  parseFrontmatterStatus,
  withUpdatedStatus,
} from './contract_status.ts';

const contract = (options: { frontmatter: string; table: string }): string =>
  [
    '---',
    'id: C-999',
    `status: ${options.frontmatter}`,
    '---',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| **Status** | ${options.table} |`,
    '',
  ].join('\n');

describe('parseContractStatus / parseFrontmatterStatus', () => {
  it('reads the metadata table status', () => {
    expect(parseContractStatus(contract({ frontmatter: 'draft', table: 'approved' }))).toBe(
      'approved',
    );
  });

  it('reads the frontmatter status', () => {
    expect(
      parseFrontmatterStatus(contract({ frontmatter: 'implemented', table: 'approved' })),
    ).toBe('implemented');
  });

  it('returns undefined when there is no frontmatter', () => {
    expect(parseFrontmatterStatus('| **Status** | draft |')).toBeUndefined();
  });
});

describe('detectStatusConflict', () => {
  it('reports no conflict when both representations agree', () => {
    const result = detectStatusConflict(contract({ frontmatter: 'approved', table: 'approved' }));
    expect(result.conflicting).toBe(false);
    expect(result.table).toBe('approved');
    expect(result.frontmatter).toBe('approved');
  });

  it('detects the C-472 drift: frontmatter implemented, table approved', () => {
    const result = detectStatusConflict(
      contract({ frontmatter: 'implemented', table: 'approved' }),
    );
    expect(result.conflicting).toBe(true);
    expect(result.table).toBe('approved');
    expect(result.frontmatter).toBe('implemented');
  });

  it('is not a conflict when frontmatter is absent (pre-frontmatter contracts)', () => {
    const result = detectStatusConflict('| **Status** | implemented |');
    expect(result.conflicting).toBe(false);
    expect(result.frontmatter).toBeUndefined();
  });
});

describe('withUpdatedStatus', () => {
  it('keeps both representations in step when writing', () => {
    const updated = withUpdatedStatus(
      contract({ frontmatter: 'approved', table: 'approved' }),
      'implemented',
    );
    expect(parseFrontmatterStatus(updated)).toBe('implemented');
    expect(parseContractStatus(updated)).toBe('implemented');
    expect(detectStatusConflict(updated).conflicting).toBe(false);
  });
});
