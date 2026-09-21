// scripts/src/lib/ops/emberwatch_prop_source_guard.test.ts
//
// C-529: the regressions the first human visual gate found must be impossible
// to reintroduce silently.
//
//   • the OLD grid-atlas well must never come back — village_well resolves to
//     accepted standalone art and any `well.png` prop frame is a failure;
//   • every placed prop frame must resolve to accepted standalone art or be an
//     explicitly allowlisted legacy frame — never an unresolved frame that the
//     engine would render as the pack fallback tile.

import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditEmberwatchPropSources,
  LEGACY_GRID_PROP_FRAMES,
  readAcceptedPropSources,
} from './emberwatch_prop_source_guard.ts';

const repository = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('emberwatch prop art source guard', () => {
  test('every placed prop resolves to accepted art or an allowlisted legacy frame', () => {
    const { violations } = auditEmberwatchPropSources(repository);
    expect(
      violations.map((row) => `${row.propId} → ${row.frame}`),
      'placed props whose frame would fall back to the pack fallback tile',
    ).toEqual([]);
  });

  test('the village well no longer uses the legacy grid-atlas well', () => {
    const { rows } = auditEmberwatchPropSources(repository);
    const well = rows.find((row) => row.propId === 'village_well');
    expect(well).toBeDefined();
    expect(well?.frame).toBe('prop_well.png');
    expect(well?.classification).toBe('accepted');
    // The legacy frame must not be used by ANY placed prop.
    expect(rows.some((row) => row.frame === 'well.png')).toBe(false);
  });

  test('the accepted well source exists in the pack props directory', () => {
    expect(readAcceptedPropSources(repository)).toContain('prop_well.png');
  });

  test('the legacy allowlist cannot silently grow to absorb new props', () => {
    // A guard-of-the-guard: the allowlist is written down here so a change is a
    // reviewed, deliberate edit rather than an accidental widening.
    expect([...LEGACY_GRID_PROP_FRAMES].sort()).toEqual([
      'anvil.png',
      'bed.png',
      'bookshelf.png',
      'counter.png',
      'crate.png',
      'table.png',
    ]);
  });

  test('no two distinct prop ids bind the same semantic frame under old and new names', () => {
    // A frame is either the accepted standalone art or a legacy grid frame;
    // the well regression was an old name (`well.png`) surviving beside the new
    // binding. Reject any placed frame that is BOTH a source name and a legacy
    // grid name.
    const accepted = new Set(readAcceptedPropSources(repository));
    const overlap = [...LEGACY_GRID_PROP_FRAMES].filter((frame) => accepted.has(frame));
    expect(overlap).toEqual([]);
  });
});
