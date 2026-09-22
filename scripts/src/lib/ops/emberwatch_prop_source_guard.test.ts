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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditEmberwatchPropSources,
  LEGACY_GRID_PROP_FRAMES,
  readAcceptedPropSources,
} from './emberwatch_prop_source_guard.ts';

const repository = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const writePlacementMap = (options: {
  repository: string;
  mapId: string;
  propId: string;
  frame: string;
}): void => {
  writeFileSync(
    join(options.repository, 'content/packs/emberwatch/maps', `${options.mapId}.json`),
    JSON.stringify({
      layers: [
        {
          objects: [
            {
              type: 'prop',
              properties: [
                { name: 'propId', value: options.propId },
                { name: 'frame', value: options.frame },
              ],
            },
          ],
        },
      ],
    }),
  );
};

const withPlacementRepository = (run: (isolatedRepository: string) => void): void => {
  const isolatedRepository = mkdtempSync(join(tmpdir(), 'aikami-prop-source-'));
  mkdirSync(join(isolatedRepository, 'content/packs/emberwatch/maps'), { recursive: true });
  mkdirSync(join(isolatedRepository, 'content/packs/emberwatch/props'), { recursive: true });
  try {
    run(isolatedRepository);
  } finally {
    rmSync(isolatedRepository, { recursive: true, force: true });
  }
};

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
    // reviewed, deliberate edit rather than an accidental widening. It is empty
    // as of the 5.0.0 polish pass — every former legacy-grid furniture frame now
    // resolves to accepted standalone art.
    expect([...LEGACY_GRID_PROP_FRAMES].sort()).toEqual([]);
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

  test('matching frames aggregate every map for the prop id', () => {
    withPlacementRepository((isolatedRepository) => {
      writePlacementMap({
        repository: isolatedRepository,
        mapId: 'first',
        propId: 'shared_prop',
        frame: 'prop_shared.png',
      });
      writePlacementMap({
        repository: isolatedRepository,
        mapId: 'second',
        propId: 'shared_prop',
        frame: 'prop_shared.png',
      });

      const { rows } = auditEmberwatchPropSources(isolatedRepository);
      expect(rows).toEqual([
        {
          propId: 'shared_prop',
          frame: 'prop_shared.png',
          maps: ['first', 'second'],
          classification: 'unresolved',
        },
      ]);
    });
  });

  test('conflicting frames for one prop id fail the source audit', () => {
    withPlacementRepository((isolatedRepository) => {
      writePlacementMap({
        repository: isolatedRepository,
        mapId: 'first',
        propId: 'conflicted_prop',
        frame: 'first.png',
      });
      writePlacementMap({
        repository: isolatedRepository,
        mapId: 'second',
        propId: 'conflicted_prop',
        frame: 'second.png',
      });

      expect(() => auditEmberwatchPropSources(isolatedRepository)).toThrow(
        'prop "conflicted_prop" uses conflicting frames "first.png" and "second.png"',
      );
    });
  });
});
