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
import type { PlayerStateServiceInterface } from './player_state_service.svelte';
import type { QuestStateServiceInterface } from './quest_state_service.svelte';

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
