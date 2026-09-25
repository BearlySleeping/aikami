// packages/frontend/engine/src/__tests__/worker_restore_reasserts_persona.test.ts
//
// RESTORE_PLAYER must re-assert the persona's base appearance layers over a
// snapshot's, for the same reason a fresh boot does.
//
// The regression this guards: `initializeEngine` re-seeds the base layers from
// the persona (C-430), but `RESTORE_PLAYER` used to copy the snapshot's
// `Appearance.layers` straight onto the player. Those are POSITIONAL catalog
// indices, so a save written while gear was equipped carries the equipped
// garments as the character's BASE outfit — e.g. `[5,3,23,24,7,102]`, where
// torso 23 is chainmail and feet 7 are boots. Restoring that reinstalls the
// equipped look as the base, so unequipping removes the equipment recipe while
// the identical garment still renders underneath: the toggle is a no-op.
//
// `resolvePlayerBaseLayers` is unit-tested in
// `appearance_base_layers.test.ts`; what was missing was the CALL on the
// restore path, which is not reachable from a pure-function test. This asserts
// the worker's source wires it into BOTH RESTORE_PLAYER branches, so the
// asymmetry cannot silently return.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'worker', 'ecs_worker.ts'), 'utf8');

/** Returns the body of the `case 'RESTORE_PLAYER':` arm. */
const restorePlayerCase = (): string => {
  const start = source.indexOf("case 'RESTORE_PLAYER':");
  expect(start).toBeGreaterThan(-1);
  // The arm ends at the next top-level `case` in the same switch.
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {6}case '/);
  return next === -1 ? rest : rest.slice(0, next);
};

describe('RESTORE_PLAYER re-asserts the persona base layers', () => {
  test('the restore path calls resolvePlayerBaseLayers', () => {
    expect(restorePlayerCase()).toContain('resolvePlayerBaseLayers');
  });

  test('the persona layers are retained from INITIALIZE_ENGINE', () => {
    // Without retention there is nothing to re-assert on a later restore.
    expect(source).toContain('_personaBaseLayers');
    const init = source.slice(source.indexOf("case 'INITIALIZE_ENGINE':"));
    expect(init.slice(0, 4000)).toContain('_personaBaseLayers');
  });

  test('BOTH adoption branches are covered, not just one', () => {
    // Two branches: copy-onto-existing-player, and adopt-restored-as-player.
    // A guard that only fixed one would leave the other restoring stale layers.
    const count = (restorePlayerCase().match(/resolvePlayerBaseLayers\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('the snapshot layers are no longer copied verbatim', () => {
    // The old defect in one line: trusting the snapshot as the base look.
    expect(restorePlayerCase()).not.toMatch(
      /setAppearanceLayers\(world, playerEntityId, getAppearanceLayers\(restoredEid\)\)/,
    );
  });
});
