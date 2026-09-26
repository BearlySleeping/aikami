// packages/frontend/engine/src/components/appearance_base_layers.test.ts
//
// Which layers the PLAYER carries when a save is restored.
//
// Regression: `Appearance.layers` stores POSITIONAL catalog indices, so the ECS
// save persists a derived value — the indices that matched the persona's recipe
// at save time. Restoring it after the recipe changed brought back the OLD
// assets, silently. For the player that is not cosmetic: equipment merges over
// the base with `mergeLpcRecipes` (replace or append only), so a stale base that
// resolves to the same asset an equipped item provides makes equip/unequip a
// visual no-op. Observed in the field: a save carrying torso index 23
// (`torso/chainmail_male`) overrode the corrected persona recipe, so equipping
// and unequipping chainmail produced an identical sprite.

import { describe, expect, test } from 'bun:test';
import { resolvePlayerBaseLayers } from './appearance.ts';

/** The corrected persona recipe's indices, as the boot service computes them. */
const PERSONA_LAYERS = [5, 3, 49, 24, 19, 102];
/** Stale indices from a save written before the recipe was corrected. */
const STALE_SAVED_LAYERS = [5, 3, 23, 24, 7, 102];

describe('resolvePlayerBaseLayers', () => {
  test('the persona wins over a restored save', () => {
    expect(
      resolvePlayerBaseLayers({ restored: STALE_SAVED_LAYERS, fromPersona: PERSONA_LAYERS }),
    ).toEqual(PERSONA_LAYERS);
  });

  test('the restored save is used when the persona supplies nothing', () => {
    // Sandboxes and dev callers may not pass a persona recipe; the save must
    // still be honoured rather than blanking the sprite.
    expect(resolvePlayerBaseLayers({ restored: STALE_SAVED_LAYERS })).toEqual(STALE_SAVED_LAYERS);
    expect(resolvePlayerBaseLayers({ restored: STALE_SAVED_LAYERS, fromPersona: [] })).toEqual(
      STALE_SAVED_LAYERS,
    );
  });

  test('an empty persona recipe never blanks the sprite', () => {
    expect(resolvePlayerBaseLayers({ restored: [1, 2, 3], fromPersona: undefined })).toEqual([
      1, 2, 3,
    ]);
  });

  test('with neither source the result is empty, not undefined', () => {
    expect(resolvePlayerBaseLayers({})).toEqual([]);
  });

  test('the result is the persona array, not a stale reference', () => {
    const result = resolvePlayerBaseLayers({
      restored: STALE_SAVED_LAYERS,
      fromPersona: PERSONA_LAYERS,
    });
    expect(result).not.toBe(STALE_SAVED_LAYERS);
    expect(result[2]).toBe(49);
    expect(result[2]).not.toBe(23);
  });
});
