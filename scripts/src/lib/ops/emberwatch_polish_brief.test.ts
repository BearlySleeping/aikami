// scripts/src/lib/ops/emberwatch_polish_brief.test.ts
//
// The Astra handoff brief must stay valid and complete: five maps, the current
// legacy-art TODO set, locked identities, and the command surface.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_GRID_PROP_FRAMES } from './emberwatch_prop_source_guard.ts';

const repository = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const briefPath = join(repository, 'docs/plans/emberwatch_polish_brief.json');

type Brief = {
  grid: { groundTilePx: number };
  topology: Record<string, unknown>;
  npcLocations: Array<{ npcId: string }>;
  legacyArtTodos: { frames: string[] };
  commands: string[];
  lockedIdentities: string[];
};

describe('emberwatch polish brief', () => {
  const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as Brief;

  test('declares the 32px ground grid', () => {
    expect(brief.grid.groundTilePx).toBe(32);
  });

  test('covers exactly the five maps', () => {
    expect(Object.keys(brief.topology).sort()).toEqual([
      'inn',
      'merchant_shop',
      'old_road',
      'ruined_shrine',
      'village',
    ]);
  });

  test('lists the ten canonical NPCs', () => {
    expect(brief.npcLocations.length).toBe(10);
  });

  test('legacy TODOs match the enforced allowlist', () => {
    expect(new Set(brief.legacyArtTodos.frames)).toEqual(new Set(LEGACY_GRID_PROP_FRAMES));
  });

  test('documents the locked identities and the studio command', () => {
    expect(brief.lockedIdentities.length).toBeGreaterThan(0);
    expect(brief.commands).toContain('bun run emberwatch:studio');
  });
});
