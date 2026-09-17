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

const asCrlf = (content: string): string => content.replaceAll('\n', '\r\n');

/** True when every line break in `content` is CRLF (no bare LF survived). */
const usesOnlyCrlf = (content: string): boolean => !/(?<!\r)\n/.test(content);

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

  it('reads frontmatter delimited with CRLF line endings', () => {
    const crlfContract = asCrlf(contract({ frontmatter: 'implemented', table: 'approved' }));
    expect(parseFrontmatterStatus(crlfContract)).toBe('implemented');
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

  it('reconciles a CRLF contract — frontmatter and table both updated', () => {
    const updated = withUpdatedStatus(
      asCrlf(contract({ frontmatter: 'approved', table: 'approved' })),
      'implemented',
    );
    expect(parseFrontmatterStatus(updated)).toBe('implemented');
    expect(parseContractStatus(updated)).toBe('implemented');
    expect(detectStatusConflict(updated).conflicting).toBe(false);
  });

  it('preserves the CRLF convention instead of converting the file to LF', () => {
    const updated = withUpdatedStatus(
      asCrlf(contract({ frontmatter: 'approved', table: 'approved' })),
      'implemented',
    );
    expect(usesOnlyCrlf(updated)).toBe(true);
    // Nothing but the status value changed: same line count, same bytes
    // elsewhere.
    const original = asCrlf(contract({ frontmatter: 'approved', table: 'approved' }));
    expect(updated.split('\r\n')).toHaveLength(original.split('\r\n').length);
  });

  it('fixes a CRLF frontmatter/table conflict in one pass', () => {
    const drifted = asCrlf(contract({ frontmatter: 'implemented', table: 'approved' }));
    expect(detectStatusConflict(drifted).conflicting).toBe(true);

    const reconciled = withUpdatedStatus(drifted, 'approved');

    expect(detectStatusConflict(reconciled).conflicting).toBe(false);
    expect(parseFrontmatterStatus(reconciled)).toBe('approved');
    expect(parseContractStatus(reconciled)).toBe('approved');
    expect(usesOnlyCrlf(reconciled)).toBe(true);
  });

  it('leaves a frontmatter-less contract unchanged apart from the table row', () => {
    const updated = withUpdatedStatus('| **Status** | draft |\n', 'approved');
    expect(parseContractStatus(updated)).toBe('approved');
    expect(parseFrontmatterStatus(updated)).toBeUndefined();
    expect(updated).toBe('| **Status** | approved |\n');
  });

  it('throws when the metadata status row is absent', () => {
    expect(() => withUpdatedStatus('no status row here', 'approved')).toThrow(
      /status row not found/,
    );
  });
});
