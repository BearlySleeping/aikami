// apps/frontend/client/src/lib/services/game/combat_encounter_environment.ts
//
// Content-pack → encounter environment projection (Combat-07).
//
// The content-pack loader lives on the MAIN thread, so this is where an
// authored encounter's battlefield objects become the pinned environmental pair
// the engine resolves against. It compiles:
//
//   - every prop whose definition carries an `environment` block into a
//     `BattlefieldObjectDefinition` + its registered affordances, and
//   - the encounter's authored object placements and impact zones.
//
// Nothing here is a second object catalog: the prop definition stays the source
// of the object's durability, cover and affordances, and the encounter
// placement only instantiates it.
//
// Contract: C-531 AC-1, AC-6

import type { ContentPackLoaderInterface, EncounterEnvironment } from '@aikami/frontend/engine';
import { buildEnvironmentFromContent } from '@aikami/utils';
import { logger } from '$logger';

/**
 * Builds the pinned environmental pair for one authored encounter.
 *
 * Distinguishes an encounter with no authored objects from invalid authored
 * content so roster construction can preserve the former and reject the latter.
 */
export const buildEncounterEnvironmentFromContentPack = (options: {
  contentPack: ContentPackLoaderInterface;
  encounterId: string;
}):
  | { ok: true; environment: EncounterEnvironment | undefined }
  | { ok: false; issues: string[] } => {
  const { contentPack, encounterId } = options;
  const encounter = contentPack.getEncounter(encounterId);
  const authored = encounter?.environment;
  if (encounter === undefined || authored === undefined) {
    return { ok: true, environment: undefined };
  }
  if (authored.objects === undefined || authored.objects.length === 0) {
    return { ok: true, environment: undefined };
  }

  const result = buildEnvironmentFromContent({
    props: contentPack.manifest.props ?? {},
    objects: authored.objects,
    impactZones: authored.impactZones ?? {},
  });
  if (!result.ok) {
    logger.warn('combatEncounterEnvironment:invalid-authored-content', {
      encounterId,
      issues: result.issues,
    });
    return { ok: false, issues: result.issues };
  }

  return { ok: true, environment: { state: result.state, bundle: result.bundle } };
};
