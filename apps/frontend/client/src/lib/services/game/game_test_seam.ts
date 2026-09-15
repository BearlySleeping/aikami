// apps/frontend/client/src/lib/services/game/game_test_seam.ts
//
// Non-production test seam (C-495 AC-6, C-500, C-514, C-516 AC-10).
//
// Installs `window.__AIKAMI_TEST__` ONLY when `getPublicMode() !== 'production'`.
// Every probe drives the PRODUCTION path — discovery, derivation, validation,
// precondition and command execution are unchanged; only the *trigger* (an AI
// provider, a dialogue chip, a pointer) is replaced by a direct call.
//
// Extracted from `game_composition_root.svelte.ts` so the composition root stays
// inside the source-file-size hard limit. It is a single cohesive
// responsibility with no production consumer, and it is the only module allowed
// to name `__AIKAMI_TEST__`.
//
// The engine is deliberately NOT imported here: the composition root loads
// `@aikami/frontend/engine` dynamically to keep the boot chunk small, so
// `createEngineBridge`/`djb2Hash` arrive as options instead of pulling the
// engine back into a static import graph.
//
// Contract: C-495 AC-6, C-500, C-514, C-516 AC-10

import { getPublicMode } from '@aikami/frontend/configs';
import type { EngineBridge } from '@aikami/frontend/engine';
// Type-only: erased at build time, so this never pulls the (dynamically
// imported) engine back into a static import graph.
import type { ContentPackLoaderInterface } from '@aikami/frontend/engine/sim';
import { buildEncounterRosterFromContentPack } from './combat_encounter_roster.ts';
import type { GameEngineServiceInterface } from './game_engine_service.svelte';
import type { GameModeServiceInterface } from './game_mode_service.svelte';
import type { GameOverlayServiceInterface } from './game_overlay_service.svelte';
import type { NpcDialogueServiceInterface } from './npc_dialogue_service.svelte';
import { partyRosterService } from './party_roster_service.svelte.ts';
import type { PlayerStateServiceInterface } from './player_state_service.svelte';
import type { QuestStateServiceInterface } from './quest_state_service.svelte';

/**
 * Synthetic ally id used when the loaded pack authors no distinct combat-capable
 * companion (C-526 AC-6 E2E). The STATS are real authored stats; only the
 * identity is synthetic, and it is distinct so validation accepts the roster.
 */
const ALLY_COMBATANT_ID = 'e2e_companion_ally';

/**
 * Everything the seam drives — all of it production, none of it replaced.
 *
 * Deliberately module-private: the composition root is the only caller and it
 * passes an object literal, so exporting the shape would only add unused
 * public surface (guard-orphaned-capability).
 */
type GameTestSeamOptions = {
  /** Unsubscribers owned by the composition root; the seam adds its own. */
  bridgeUnsubscribers: Array<() => void>;
  contentPack: ContentPackLoaderInterface;
  gameEngineService: GameEngineServiceInterface;
  gameModeService: GameModeServiceInterface;
  gameOverlayService: GameOverlayServiceInterface;
  npcDialogueService: NpcDialogueServiceInterface;
  playerStateService: PlayerStateServiceInterface;
  questStateService: QuestStateServiceInterface;
  /** The engine's own bridge factory (dynamic import in the caller). */
  createEngineBridge: () => EngineBridge;
  /** Deterministic encounter seed derivation (dynamic import in the caller). */
  djb2Hash: (value: string) => number;
  /** Diagnostics sink for a seam that failed to install. */
  warn: (label: string, detail: Record<string, unknown>) => void;
};

/**
 * Installs the seam, or does nothing in production or outside a browser.
 *
 * Failures are reported, never thrown: a broken probe must not be able to stop
 * the boot pipeline.
 */
export const installGameTestSeam = (deps: GameTestSeamOptions): void => {
  if (getPublicMode() === 'production' || typeof window === 'undefined') {
    return;
  }

  const {
    bridgeUnsubscribers,
    contentPack,
    createEngineBridge,
    djb2Hash,
    gameEngineService,
    gameModeService,
    gameOverlayService,
    npcDialogueService,
    playerStateService,
    questStateService,
    warn,
  } = deps;

  try {
    let combatCleanupResumeCount = 0;
    let combatCleanupResumeBaseline = 0;
    let combatEndTurnDispatchCount = 0;
    const testBridge = createEngineBridge();
    bridgeUnsubscribers.push(
      testBridge.onCommand('COMBAT_END_TURN', () => {
        combatEndTurnDispatchCount += 1;
      }),
    );
    const resumeEngine = gameEngineService.resumeEngine.bind(gameEngineService);
    gameEngineService.resumeEngine = (): void => {
      combatCleanupResumeCount += 1;
      resumeEngine();
    };
    Object.assign(window, {
      // biome-ignore lint/style/useNamingConvention: __AIKAMI_TEST__ is the fixed key the release-gate E2E reads back
      __AIKAMI_TEST__: {
        discoverEvidenceAt: (location: string): string[] =>
          questStateService.discoverEvidenceAt(location),
        presentEvidence: (options: {
          npcId: string;
          evidenceId: string;
        }): { commandAvailable: boolean; flagSet: boolean } => {
          const command = {
            kind: 'presentEvidence' as const,
            evidenceId: options.evidenceId,
          };
          const commandAvailable = npcDialogueService
            .deriveAllowedCommands(options.npcId)
            .includes(command.kind);
          const flagSet =
            commandAvailable &&
            npcDialogueService.executeCommand({
              kind: command.kind,
              npcId: options.npcId,
              npcName: contentPack.getNpc(options.npcId)?.name ?? 'Unknown',
              command,
            });
          return { commandAvailable, flagSet };
        },
        // C-500 test seam: drive combat through the production overlay
        // entry/exit path without depending on the AI-generated dialogue
        // chip that normally starts it. Used by
        // apps/e2e/tests/client/combat.spec.ts to prove the combat UI
        // mounts and exits cleanly. Gated to non-production above.
        startCombat: (options: { enemyName: string; enemyNpcId?: string }): void => {
          combatCleanupResumeBaseline = combatCleanupResumeCount;
          gameOverlayService.startCombat(options);
        },
        getCombatEndTurnDispatchCount: (): number => combatEndTurnDispatchCount,
        scheduleCombatEndedCleanup: (): void => {
          testBridge.emit({ type: 'COMBAT_ENDED', victory: true });
        },
        // C-514 test seam: drive the production combat ViewModel through
        // the real engine bridge with the turn/budget events the worker
        // emits (TURN_CHANGED → ACTION_ECONOMY_CHANGED). Used by
        // apps/e2e/tests/client/combat.spec.ts to prove the four-budget
        // readout and the explicit End Turn control are wired in the
        // production overlay. The events are the production shapes; only
        // their origin (the ECS worker) is stubbed here.
        emitCombatTurn: (options: {
          currentEntityId: number;
          activeEntities: number[];
          actionEconomy: {
            movementRemaining: number;
            actionAvailable: boolean;
            quickActionAvailable: boolean;
            bonusActionAvailable: boolean;
            reactionAvailable: boolean;
          };
        }): void => {
          testBridge.emit({
            type: 'TURN_CHANGED',
            currentEntityId: options.currentEntityId,
            activeEntities: options.activeEntities,
          });
          testBridge.emit({
            type: 'ACTION_ECONOMY_CHANGED',
            entityId: options.currentEntityId,
            ...options.actionEconomy,
          });
        },
        /**
         * C-516 AC-10 test seam: launches the REAL authored encounter from
         * the content pack through the production start path (no stubbed
         * roster), so the E2E lane can play a genuine v2 vertical slice
         * without an AI provider.
         */
        startRealEncounter: (options: { encounterId: string; engine?: 'legacy' | 'v2' }): void => {
          combatCleanupResumeBaseline = combatCleanupResumeCount;
          const encounter = contentPack.getEncounter(options.encounterId);
          const roster = buildEncounterRosterFromContentPack({
            contentPack,
            encounterId: options.encounterId,
            player: {
              combatantId: 'player',
              classIds: [playerStateService.classId],
            },
          });
          gameOverlayService.startCombat({
            enemyName: encounter?.name ?? options.encounterId,
            encounterId: options.encounterId,
            seed: djb2Hash(options.encounterId),
            engine: options.engine ?? 'v2',
            ...(roster === undefined ? {} : { roster }),
          });
        },
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
        startMultiHostileEncounter: (options: { npcId: string; count: number }): void => {
          combatCleanupResumeBaseline = combatCleanupResumeCount;
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
        },
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
        startCompanionEncounter: (options: {
          encounterId: string;
          companionNpcId?: string;
          companionMode?: 'direct' | 'suggest' | 'intent' | 'autonomous';
          companionIntent?: string;
        }): boolean => {
          combatCleanupResumeBaseline = combatCleanupResumeCount;
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
          // The ALLY slot. A preferred companion is used only when the loaded
          // pack actually authors combat stats for it; otherwise the encounter's
          // own hostile fills the slot. The deployed asset seed lags the repo's
          // combat-capable NPCs (see combat_v2.spec.ts), so resolving this at
          // runtime is what keeps the lane runnable in every environment
          // without stubbing the roster.
          const preferred = options.companionNpcId;
          let companionNpc = preferred === undefined ? undefined : contentPack.getNpc(preferred);
          let companionNpcId = preferred;
          let companionName = companionNpc?.name;
          let companionClassId = companionNpc?.companionClassId;
          let companionStats = companionNpc?.combatStats;
          if (companionStats === undefined) {
            // A distinct authored combatant, when the loaded pack has one.
            const alternative = contentPack
              .getAllEncounters()
              .flatMap((entry) => entry.enemyNpcIds)
              .find(
                (candidate) =>
                  candidate !== enemyNpcId &&
                  contentPack.getNpc(candidate)?.combatStats !== undefined,
              );
            if (alternative !== undefined) {
              const alternativeNpc = contentPack.getNpc(alternative);
              companionNpcId = alternative;
              companionNpc = alternativeNpc;
              companionName = alternativeNpc?.name;
              companionClassId = alternativeNpc?.companionClassId;
              companionStats = alternativeNpc?.combatStats;
            } else {
              // The deployed pack authors no distinct combat-capable companion
              // (it ships ONE combat NPC), so the ally slot takes a synthetic id
              // with the REAL authored stats of a resolvable combatant. The id
              // must differ from the enemy's or validation would reject a roster
              // that puts one combatant on both teams; everything else — stats,
              // roster projection, worker placement, v2 kernel, control-mode
              // plumbing — is the production path.
              companionNpcId = ALLY_COMBATANT_ID;
              companionNpc = undefined;
              companionName = `${enemy?.name ?? enemyNpcId} (ally)`;
              companionClassId = enemy?.companionClassId;
              companionStats = enemyStats;
            }
          }
          if (companionNpcId === undefined || companionStats === undefined) {
            warn('startCompanionEncounter:no-usable-ally', { encounterId: options.encounterId });
            return false;
          }
          // Recruit through the roster so the party (and the mode) is the real
          // persisted source the composition root reads.
          if (!partyRosterService.hasMember(companionNpcId)) {
            partyRosterService.recruit({
              npcId: companionNpcId,
              name: companionName ?? companionNpcId,
              classId: companionClassId ?? 'fighter',
              level: 1,
              initialApproval: 0,
            });
          }
          const mode = options.companionMode ?? 'suggest';
          partyRosterService.setControlMode({
            npcId: companionNpcId,
            mode,
            ...(options.companionIntent === undefined ? {} : { intent: options.companionIntent }),
          });
          const encounterId = `e2e_companion_${options.encounterId}`;
          const outcome = gameOverlayService.startCombat({
            enemyName: `${enemy?.name ?? enemyNpcId} (pack)`,
            encounterId,
            seed: djb2Hash(encounterId),
            engine: 'v2',
            roster: {
              participants: [
                { combatantId: 'player', team: 'player', classIds: [playerStateService.classId] },
                {
                  combatantId: companionNpcId,
                  team: 'ally',
                  ...(companionNpc === undefined ? {} : { npcId: companionNpcId }),
                  displayName: companionName ?? companionNpcId,
                  stats: {
                    hitPoints: companionStats.hitPoints,
                    armorClass: companionStats.armorClass,
                    attackBonus: companionStats.attackBonus,
                    initiative: companionStats.initiativeBonus ?? 0,
                  },
                  controlMode: mode,
                },
                // Two targetable hostiles make the companion edit control a real
                // alternative. Both reuse authored stats; the second target's
                // armour differs so the rendered hit forecast proves re-preview.
                ...Array.from({ length: 2 }, (_, index) => ({
                  combatantId: index === 0 ? enemyNpcId : `${enemyNpcId}#${index + 1}`,
                  team: 'enemy' as const,
                  npcId: enemyNpcId,
                  displayName: `${enemy?.name ?? enemyNpcId} ${index + 1}`,
                  stats: {
                    hitPoints: enemyStats.hitPoints,
                    armorClass: enemyStats.armorClass + index * 2,
                    attackBonus: enemyStats.attackBonus,
                    initiative: (enemyStats.initiativeBonus ?? 0) - index,
                  },
                })),
              ],
            },
          });
          if (!outcome.ok) {
            warn('startCompanionEncounter:combat-start-rejected', {
              reason: outcome.reason,
              messageKey: outcome.messageKey,
            });
          }
          return outcome.ok;
        },
        /** C-526: the ally combatant id this seam will use for an encounter. */
        companionCombatantIdFor: (options: {
          encounterId: string;
          companionNpcId?: string;
        }): string | undefined => {
          const preferred = options.companionNpcId;
          if (preferred !== undefined && contentPack.getNpc(preferred)?.combatStats !== undefined) {
            return preferred;
          }
          const enemyNpcId = contentPack.getEncounter(options.encounterId)?.enemyNpcIds[0];
          return (
            contentPack
              .getAllEncounters()
              .flatMap((entry) => entry.enemyNpcIds)
              .find(
                (candidate) =>
                  candidate !== enemyNpcId &&
                  contentPack.getNpc(candidate)?.combatStats !== undefined,
              ) ?? ALLY_COMBATANT_ID
          );
        },
        /** C-526: the persisted companion preference, as the roster holds it. */
        getCompanionPreference: (
          npcId: string,
        ): { mode: string; intent: string; recruited: boolean } => {
          const member = partyRosterService.getMember(npcId);
          return {
            mode: member?.controlMode ?? 'none',
            intent: member?.standingIntent ?? '',
            recruited: member !== undefined,
          };
        },
        dismissCombat: (): void => {
          gameOverlayService.closeCombat();
        },
        /**
         * C-516 test seam: whether the GameWorld has registered its combat
         * command forwarders yet. A command sent before that is dropped by
         * design, so the E2E must wait for routability instead of assuming
         * the overlay being open means the engine can be commanded.
         */
        isCombatStartRoutable: (): boolean =>
          testBridge.hasCommandHandler('COMBAT_START_ENCOUNTER'),
        getCombatCleanupResumeCount: (): number =>
          combatCleanupResumeCount - combatCleanupResumeBaseline,
        getOverlayState: (): { overlay: string; mode: string } => ({
          overlay: gameOverlayService.activeOverlay,
          mode: gameModeService.currentMode,
        }),
      },
    });
  } catch (error) {
    warn('initialize:test-hook-failed', { error: String(error) });
  }
};
