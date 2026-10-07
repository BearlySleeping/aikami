// apps/frontend/client/src/lib/services/game/game_test_seam_encounter_probes.ts
//
// C-516 AC-10 / C-525 AC-5 / C-526 AC-6 / C-531 authored-encounter probes for
// the non-production test seam.
//
// Split out of `game_test_seam.ts`: the seam had grown past the
// source-file-size hard limit, and the ENCOUNTER lifecycle — resolve an authored
// encounter, recruit its ally, project a roster, start it through the
// production overlay, and walk the player to the map it is authored on — is one
// cohesive responsibility with a wide dependency footprint that the rest of the
// seam (management stores, evidence presentation, map/audio/capture probes)
// never touches.
//
// Like the text and dialogue probe modules, these are measurement apparatus,
// not product code: every probe drives the production roster projection, the
// production overlay entry point and the production map loader. Only the
// TRIGGER is a direct call. Reachable only through `window.__AIKAMI_TEST__`,
// which `game_test_seam.ts` installs outside production mode.

import type { ContentPackLoaderInterface } from '@aikami/frontend/engine/sim';
import type { CompanionControlMode, ContentPackCombatStats } from '@aikami/types';
import {
  buildEncounterRosterFromContentPack,
  checkModifiersFromCharacterSheet,
} from './combat_encounter_roster.ts';
import type { GameEngineServiceInterface } from './game_engine_service.svelte';
import type { GameOverlayServiceInterface } from './game_overlay_service.svelte';
import {
  ALLY_COMBATANT_ID,
  type AllySlot,
  createAllySlotResolver,
} from './game_test_seam_ally_slot.ts';
import { partyRosterService } from './party_roster_service.svelte.ts';
import type { PlayerStateServiceInterface } from './player_state_service.svelte';

/**
 * The encounter probes the seam installs on `window.__AIKAMI_TEST__`.
 *
 * Deliberately module-private: the seam is the only caller and spreads the
 * result into its own surface, so exporting the shape would only add unused
 * public surface (guard-orphaned-capability).
 */
type EncounterProbes = {
  /** C-516 AC-10: start a REAL authored encounter through the production path. */
  readonly startRealEncounter: (options: {
    readonly encounterId: string;
    readonly engine?: 'legacy' | 'v2';
    /**
     * Review F11: the recruited companion the authored proof roster
     * carries. Resolved from the PARTY ROSTER (the same persisted source
     * the composition root reads), so the proof fight is player + real
     * companion vs the authored hostiles — never a synthetic ally.
     */
    readonly companionNpcId?: string;
  }) => void;
  /** C-531: load the map the encounter is authored on, through production. */
  readonly travelToEncounterMap: (options: { readonly encounterId: string }) => Promise<void>;
  /** C-525 AC-5: start a MULTI-HOSTILE encounter from authored pack stats. */
  readonly startMultiHostileEncounter: (options: {
    readonly npcId: string;
    readonly count: number;
  }) => void;
  /** C-526 AC-6: recruit a companion into the party roster and fight beside it. */
  readonly startCompanionEncounter: (options: {
    readonly encounterId: string;
    readonly companionNpcId?: string;
    readonly companionMode?: CompanionControlMode;
    readonly companionIntent?: string;
  }) => boolean;
  /** C-526: the ally combatant id this seam will use for an encounter. */
  readonly companionCombatantIdFor: (options: {
    readonly encounterId: string;
    readonly companionNpcId?: string;
  }) => string | undefined;
  /** C-526: the persisted companion preference, as the roster holds it. */
  readonly getCompanionPreference: (npcId: string) => {
    readonly mode: string;
    readonly intent: string;
    readonly recruited: boolean;
  };
};

/**
 * Builds the encounter probes against the seam's injected capabilities.
 *
 * The engine is deliberately NOT imported here: the composition root loads
 * `@aikami/frontend/engine` dynamically to keep the boot chunk small, so the
 * deterministic `djb2Hash` arrives as an option instead of pulling the engine
 * back into a static import graph.
 */
export const createEncounterProbes = (deps: {
  readonly contentPack: ContentPackLoaderInterface;
  readonly gameEngineService: GameEngineServiceInterface;
  readonly gameOverlayService: GameOverlayServiceInterface;
  readonly playerStateService: PlayerStateServiceInterface;
  /** Deterministic encounter seed derivation (dynamic import in the caller). */
  readonly djb2Hash: (value: string) => number;
  /** Diagnostics sink for a probe that could not run as asked. */
  readonly warn: (label: string, detail: Record<string, unknown>) => void;
  /**
   * Marks the current resume count as the baseline the combat-cleanup probe
   * measures against, so one encounter's start is not billed to the next.
   */
  readonly markCombatTurnStart: () => void;
}): EncounterProbes => {
  const {
    contentPack,
    djb2Hash,
    gameEngineService,
    gameOverlayService,
    markCombatTurnStart,
    playerStateService,
    warn,
  } = deps;
  const { firstAuthoredCombatNpcExcluding, resolveAllySlot } = createAllySlotResolver({
    contentPack,
  });

  /**
   * C-516 AC-10 test seam: launches the REAL authored encounter from
   * the content pack through the production start path (no stubbed
   * roster), so the E2E lane can play a genuine v2 vertical slice
   * without an AI provider.
   */
  const startRealEncounter = (options: {
    encounterId: string;
    engine?: 'legacy' | 'v2';
    /**
     * Review F11: the recruited companion the authored proof roster
     * carries. Resolved from the PARTY ROSTER (the same persisted source
     * the composition root reads), so the proof fight is player + real
     * companion vs the authored hostiles — never a synthetic ally.
     */
    companionNpcId?: string;
  }): void => {
    markCombatTurnStart();
    const encounter = contentPack.getEncounter(options.encounterId);
    // Prefer an explicit companion, then a recruited party member that
    // the loaded pack authors combat stats for. A companion that is also
    // an authored hostile of THIS encounter is left to the enemy loop —
    // the roster projection refuses a cross-team duplicate.
    const hostileNpcIds = new Set(encounter?.enemyNpcIds ?? []);
    const companionNpcId =
      options.companionNpcId ??
      partyRosterService.members
        .map((member) => member.npcId)
        .find(
          (npcId) =>
            !hostileNpcIds.has(npcId) && contentPack.getNpc(npcId)?.combatStats !== undefined,
        );
    const roster = buildEncounterRosterFromContentPack({
      contentPack,
      encounterId: options.encounterId,
      player: {
        combatantId: 'player',
        classIds: [playerStateService.classId],
        // C-531 AC-2: the sheet's check modifiers must travel with the
        // roster — see `checkModifiersFromCharacterSheet`.
        checkModifiers: checkModifiersFromCharacterSheet({
          skills: playerStateService.skills,
          abilities: playerStateService.abilities,
        }),
      },
      ...(companionNpcId === undefined ? {} : { companion: { npcId: companionNpcId } }),
    });
    gameOverlayService.startCombat({
      enemyName: encounter?.name ?? options.encounterId,
      encounterId: options.encounterId,
      seed: djb2Hash(options.encounterId),
      engine: options.engine ?? 'v2',
      ...(roster === undefined ? {} : { roster }),
    });
  };

  /**
   * C-531 test seam: walks the player to the map an encounter is
   * authored on through the PRODUCTION map loader.
   *
   * The proof encounter lives on the inn map, but the fresh boot lands
   * on the village — twenty-plus cells from the authored objects, so
   * every adjacency requirement is unmet and the whole journey would
   * read as a pack bug. A player would walk through the portal; the E2E
   * drives the same production `loadMap` (same pack, same spawn
   * coordinates the manifest authors) instead of teleporting the
   * entity, so nothing about the encounter is faked.
   */
  const travelToEncounterMap = async (options: { encounterId: string }): Promise<void> => {
    const encounter = contentPack.getEncounter(options.encounterId);
    const mapId = encounter?.mapId;
    if (mapId === undefined) {
      warn('travelToEncounterMap:unknown-encounter', { encounterId: options.encounterId });
      return;
    }
    const mapEntry = contentPack.manifest.maps[mapId];
    if (mapEntry === undefined) {
      warn('travelToEncounterMap:unknown-map', { mapId });
      return;
    }
    await gameEngineService.loadMap({
      mapUrl: contentPack.resolveMapUrl(mapId),
      targetX: mapEntry.defaultX ?? 0,
      targetY: mapEntry.defaultY ?? 0,
      packId: contentPack.packId,
    });
  };

  /**
   * C-525 AC-5 test seam: launches a MULTI-HOSTILE encounter from
   * authored pack stats through the same production start path.
   *
   * The deployed content pack ships no multi-hostile encounter (the
   * authored `proof_encounter` is not resolvable from the published seed —
   * see C-516 AC-10), so the ambiguity branch of the intent compiler
   * cannot be reached through {@link startRealEncounter}. This fixture
   * authors N copies of a REAL pack NPC with no cells, so the ENGINE's
   * deterministic formation places the first two on adjacent orthogonal
   * cells: two hostiles at equal distance, which is exactly the
   * "equally visible goblins" case the clarification policy exists for.
   *
   * Nothing about the encounter is stubbed: real NPC stats, real roster
   * projection inputs, real worker placement, real v2 kernel.
   */
  const startMultiHostileEncounter = (options: { npcId: string; count: number }): void => {
    markCombatTurnStart();
    const npc = contentPack.getNpc(options.npcId);
    const stats = npc?.combatStats;
    if (stats === undefined) {
      warn('startMultiHostileEncounter:unauthored-npc', { npcId: options.npcId });
      return;
    }
    const enemies = Array.from({ length: Math.max(2, options.count) }, (_, index) => ({
      combatantId: `${options.npcId}#${index + 1}`,
      team: 'enemy' as const,
      npcId: options.npcId,
      displayName: `${npc?.name ?? options.npcId} ${index + 1}`,
      stats: {
        hitPoints: stats.hitPoints,
        armorClass: stats.armorClass,
        attackBonus: stats.attackBonus,
        initiative: stats.initiativeBonus ?? 0,
      },
    }));
    const outcome = gameOverlayService.startCombat({
      enemyName: `${npc?.name ?? options.npcId} (pack)`,
      encounterId: 'e2e_multi_hostile_encounter',
      seed: djb2Hash(`e2e_multi_hostile:${options.npcId}`),
      engine: 'v2',
      roster: {
        participants: [
          { combatantId: 'player', team: 'player', classIds: [playerStateService.classId] },
          ...enemies,
        ],
      },
    });
    if (!outcome.ok) {
      warn('startMultiHostileEncounter:combat-start-rejected', {
        reason: outcome.reason,
        messageKey: outcome.messageKey,
      });
    }
  };

  /**
   * Recruits the resolved ally into the party roster and writes its control
   * mode, so the party (and the mode) is the real persisted source the
   * composition root reads.
   */
  const recruitAllyWithMode = (options: {
    readonly ally: AllySlot & { readonly npcId: string };
    readonly mode: CompanionControlMode;
    readonly intent: string | undefined;
  }): void => {
    if (!partyRosterService.hasMember(options.ally.npcId)) {
      partyRosterService.recruit({
        npcId: options.ally.npcId,
        name: options.ally.name,
        classId: options.ally.classId ?? 'fighter',
        level: 1,
        initialApproval: 0,
      });
    }
    partyRosterService.setControlMode({
      npcId: options.ally.npcId,
      mode: options.mode ?? 'suggest',
      ...(options.intent === undefined ? {} : { intent: options.intent }),
    });
  };

  /**
   * The v2 roster a companion encounter starts with: the player, the recruited
   * ally, and two targetable hostiles.
   *
   * Two hostiles make the companion's edit control a real alternative. Both
   * reuse authored stats; the second target's armour differs so the rendered
   * hit forecast proves the edit re-previews.
   */
  const companionRoster = (options: {
    readonly ally: AllySlot & { readonly npcId: string };
    readonly enemyNpcId: string;
    readonly enemyName: string;
    readonly enemyStats: ContentPackCombatStats;
    readonly mode: CompanionControlMode;
  }) => ({
    participants: [
      { combatantId: 'player', team: 'player' as const, classIds: [playerStateService.classId] },
      {
        combatantId: options.ally.npcId,
        team: 'ally' as const,
        // Only an AUTHORED ally carries an npcId: the synthetic slot exists
        // solely to satisfy cross-team validation.
        ...(options.ally.npc === undefined ? {} : { npcId: options.ally.npcId }),
        displayName: options.ally.name,
        stats: {
          hitPoints: options.ally.stats.hitPoints,
          armorClass: options.ally.stats.armorClass,
          attackBonus: options.ally.stats.attackBonus,
          initiative: options.ally.stats.initiativeBonus ?? 0,
        },
        controlMode: options.mode,
      },
      ...Array.from({ length: 2 }, (_, index) => ({
        combatantId: index === 0 ? options.enemyNpcId : `${options.enemyNpcId}#${index + 1}`,
        team: 'enemy' as const,
        npcId: options.enemyNpcId,
        displayName: `${options.enemyName} ${index + 1}`,
        stats: {
          hitPoints: options.enemyStats.hitPoints,
          armorClass: options.enemyStats.armorClass + index * 2,
          attackBonus: options.enemyStats.attackBonus,
          initiative: (options.enemyStats.initiativeBonus ?? 0) - index,
        },
      })),
    ],
  });

  /**
   * C-526 AC-6 test seam: recruits a companion into the PARTY ROSTER and
   * starts a v2 encounter that includes it.
   *
   * Everything is production: the roster entry comes from the content
   * pack, the mode is written through the roster's own persistence (so it
   * survives a save), and the encounter starts through
   * `gameOverlayService.startCombat` with the same companion slot the
   * dialogue chip authors. Only the TRIGGER is the seam.
   */
  const startCompanionEncounter = (options: {
    encounterId: string;
    companionNpcId?: string;
    companionMode?: CompanionControlMode;
    companionIntent?: string;
  }): boolean => {
    markCombatTurnStart();
    const encounter = contentPack.getEncounter(options.encounterId);
    const enemyNpcId = encounter?.enemyNpcIds[0];
    if (enemyNpcId === undefined) {
      warn('startCompanionEncounter:unknown-encounter', {
        encounterId: options.encounterId,
      });
      return false;
    }
    const enemy = contentPack.getNpc(enemyNpcId);
    const enemyStats = enemy?.combatStats;
    if (enemyStats === undefined) {
      warn('startCompanionEncounter:unauthored-enemy', { enemyNpcId });
      return false;
    }
    const ally = resolveAllySlot({
      preferredNpcId: options.companionNpcId,
      enemyNpc: enemy,
      enemyNpcId,
      enemyStats,
    });
    if (ally?.npcId === undefined) {
      warn('startCompanionEncounter:no-usable-ally', { encounterId: options.encounterId });
      return false;
    }
    const recruitedAlly: AllySlot & { readonly npcId: string } = { ...ally, npcId: ally.npcId };
    const mode = options.companionMode ?? 'suggest';
    recruitAllyWithMode({ ally: recruitedAlly, mode, intent: options.companionIntent });
    const enemyName = enemy?.name ?? enemyNpcId;
    const encounterId = `e2e_companion_${options.encounterId}`;
    const outcome = gameOverlayService.startCombat({
      enemyName: `${enemyName} (pack)`,
      encounterId,
      seed: djb2Hash(encounterId),
      engine: 'v2',
      roster: companionRoster({
        ally: recruitedAlly,
        enemyNpcId,
        enemyName,
        enemyStats,
        mode,
      }),
    });
    if (!outcome.ok) {
      warn('startCompanionEncounter:combat-start-rejected', {
        reason: outcome.reason,
        messageKey: outcome.messageKey,
      });
    }
    return outcome.ok;
  };

  /** C-526: the ally combatant id this seam will use for an encounter. */
  const companionCombatantIdFor = (options: {
    encounterId: string;
    companionNpcId?: string;
  }): string | undefined => {
    const preferred = options.companionNpcId;
    if (preferred !== undefined && contentPack.getNpc(preferred)?.combatStats !== undefined) {
      return preferred;
    }
    const enemyNpcId = contentPack.getEncounter(options.encounterId)?.enemyNpcIds[0];
    return (
      (enemyNpcId === undefined ? undefined : firstAuthoredCombatNpcExcluding(enemyNpcId)) ??
      ALLY_COMBATANT_ID
    );
  };

  /** C-526: the persisted companion preference, as the roster holds it. */
  const getCompanionPreference = (
    npcId: string,
  ): { mode: string; intent: string; recruited: boolean } => {
    const member = partyRosterService.getMember(npcId);
    return {
      mode: member?.controlMode ?? 'none',
      intent: member?.standingIntent ?? '',
      recruited: member !== undefined,
    };
  };

  return {
    startRealEncounter,
    travelToEncounterMap,
    startMultiHostileEncounter,
    startCompanionEncounter,
    companionCombatantIdFor,
    getCompanionPreference,
  };
};
