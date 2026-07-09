// apps/frontend/client/src/lib/views/dev/sandbox/party_follow/party_follow_sandbox_view_model.svelte.ts
//
// ViewModel for the isolated Party Follow sandbox route.
// Creates a GameWorld with a player and recruitable LPC NPC companions.
// Uses SET_ENTITY_VELOCITY (C-212) to make followers move toward the
// player with collision-aware movement through the existing ECS.
//
// Contract: C-212 Party Follow System

import type { EngineBridge, GameWorldOptions, LpcLayerRecipe } from '@aikami/frontend/engine';
import { createEngineBridge, GameWorld, TextureManager } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import type { LpcAnimationState } from '$lib/data/lpc_models';

// ---------------------------------------------------------------------------
// Lazily-resolved ECS worker constructor (SSR-safe dynamic import)
// ---------------------------------------------------------------------------

let _ecsWorkerCtor: (new () => Worker) | undefined;

const _resolveEcsWorker = async (): Promise<new () => Worker> => {
  if (_ecsWorkerCtor) {
    return _ecsWorkerCtor;
  }
  const mod = await import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module');
  _ecsWorkerCtor = mod.default as unknown as new () => Worker;
  return _ecsWorkerCtor;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A party member state tracked by the sandbox. */
export type PartyMember = {
  /** Unique ID matching the npcId sent in SPAWN_NPC. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** World spawn position. */
  readonly spawnX: number;
  readonly spawnY: number;
  /** Whether currently following the player. */
  active: boolean;
  /** ECS entity ID (resolved from npcMeta after spawn). */
  eid: number;
};

export type PartyFollowSandboxViewModelInterface = BaseViewModelInterface & {
  readonly engineReady: boolean;
  readonly engineError: string | undefined;
  readonly mapLoaded: boolean;
  readonly playerX: number;
  readonly playerY: number;
  readonly partyMembers: readonly PartyMember[];
  readonly activeCount: number;
  initializeEngine: (canvas: HTMLCanvasElement) => Promise<void>;
  togglePartyMember: (id: string) => void;
  destroyEngine: () => void;
};

export type PartyFollowSandboxViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAP_URL = '/assets/maps/sandbox_zone_a.json';
const PLAYER_SPAWN_X = 160;
const PLAYER_SPAWN_Y = 192;

/** Tick interval for velocity updates (ms). */
const FOLLOW_TICK_MS = 150;

/** Follower speed in px/s. */
const FOLLOW_SPEED = 80;

/** Offsets behind the player for each follower slot. */
const FOLLOW_OFFSETS: Array<{ dx: number; dy: number }> = [
  { dx: -40, dy: 0 },
  { dx: -56, dy: -24 },
  { dx: -56, dy: 24 },
];

const RECRUITABLE_NPCS: Omit<PartyMember, 'active' | 'eid'>[] = [
  { id: 'companion-lydia', name: 'Lydia', spawnX: 256, spawnY: 192 },
  { id: 'companion-bjorn', name: 'Bjorn', spawnX: 160, spawnY: 288 },
  { id: 'companion-mira', name: 'Mira', spawnX: 224, spawnY: 256 },
];

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class PartyFollowSandboxViewModel
  extends BaseViewModel<PartyFollowSandboxViewModelOptions>
  implements PartyFollowSandboxViewModelInterface
{
  engineReady = $state<boolean>(false);
  engineError = $state<string | undefined>(undefined);
  mapLoaded = $state<boolean>(false);
  playerX = $state<number>(PLAYER_SPAWN_X);
  playerY = $state<number>(PLAYER_SPAWN_Y);

  /** Previous frame player position for velocity direction tracking. */
  private _lastPlayerX = PLAYER_SPAWN_X;
  private _lastPlayerY = PLAYER_SPAWN_Y;

  partyMembers: PartyMember[] = $state(
    RECRUITABLE_NPCS.map((npc) => ({ ...npc, active: false, eid: 0 })),
  );

  get activeCount(): number {
    return this.partyMembers.filter((m) => m.active).length;
  }

  private _gameWorld: GameWorld | undefined;
  private _bridge: EngineBridge | undefined;
  private _textureManager: TextureManager | undefined;
  private _followInterval: ReturnType<typeof setInterval> | undefined;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    if (this._gameWorld) {
      return;
    }

    try {
      const workerCtor = await _resolveEcsWorker();

      this._bridge = createEngineBridge();
      this._textureManager = new TextureManager({});

      const paletteBytes = new Uint8Array(1024);

      // LPC recipes matching map sandbox quality
      const SandboxRecipes: Record<number, LpcLayerRecipe> = {
        // Player
        1: { slot: 'body', assetId: 'body/bodies_male', hexPalette: paletteBytes },
        2: { slot: 'hair', assetId: 'hair/plain_adult', hexPalette: paletteBytes },
        5: { slot: 'torso', assetId: 'torso/chainmail_male', hexPalette: paletteBytes },
        3: { slot: 'legs', assetId: 'legs/pants_male', hexPalette: paletteBytes },
        6: { slot: 'feet', assetId: 'feet/shoes/male', hexPalette: paletteBytes },
        4: { slot: 'head', assetId: 'head/heads/human_male', hexPalette: paletteBytes },
        // NPC
        10: { slot: 'body', assetId: 'body/bodies_female', hexPalette: paletteBytes },
        11: { slot: 'hair', assetId: 'hair/long_adult', hexPalette: paletteBytes },
        14: { slot: 'torso', assetId: 'torso/chainmail_female', hexPalette: paletteBytes },
        12: { slot: 'legs', assetId: 'legs/pants_female', hexPalette: paletteBytes },
        15: { slot: 'feet', assetId: 'feet/shoes/female', hexPalette: paletteBytes },
        13: { slot: 'head', assetId: 'head/heads/human_female', hexPalette: paletteBytes },
        // Bjorn — male NPC variant
        20: { slot: 'body', assetId: 'body/bodies_male', hexPalette: paletteBytes },
        21: { slot: 'hair', assetId: 'hair/plain_adult', hexPalette: paletteBytes },
        24: { slot: 'torso', assetId: 'torso/leather_male', hexPalette: paletteBytes },
        22: { slot: 'legs', assetId: 'legs/pants_male', hexPalette: paletteBytes },
        25: { slot: 'feet', assetId: 'feet/shoes/male', hexPalette: paletteBytes },
        23: { slot: 'head', assetId: 'head/heads/human_male', hexPalette: paletteBytes },
        // Mira — second female NPC variant
        30: { slot: 'body', assetId: 'body/bodies_female', hexPalette: paletteBytes },
        31: { slot: 'hair', assetId: 'hair/long_adult', hexPalette: paletteBytes },
        34: { slot: 'torso', assetId: 'torso/robes_female', hexPalette: paletteBytes },
        32: { slot: 'legs', assetId: 'legs/pants_female', hexPalette: paletteBytes },
        35: { slot: 'feet', assetId: 'feet/shoes/female', hexPalette: paletteBytes },
        33: { slot: 'head', assetId: 'head/heads/human_female', hexPalette: paletteBytes },
      };

      const worldOptions: GameWorldOptions = {
        className: 'PartyFollowSandboxGameWorld',
        bridge: this._bridge,
        workerFactory: () => new workerCtor(),
        recipeResolver: (layerIds) =>
          layerIds.map((id) => SandboxRecipes[id]).filter(Boolean) as LpcLayerRecipe[],
        assetUrlResolver: (slot, assetId, state) =>
          getLpcAssetPath(slot, assetId, state as unknown as LpcAnimationState),
        textureManager: this._textureManager,
      };

      this._gameWorld = GameWorld.create(worldOptions);

      await this._gameWorld.initialize({
        canvas,
        playerData: { name: 'Adventurer' },
      });

      this._registerBridgeListeners();

      await this._gameWorld.loadMap({
        mapUrl: MAP_URL,
        targetX: PLAYER_SPAWN_X,
        targetY: PLAYER_SPAWN_Y,
      });

      this.mapLoaded = true;
      this.engineReady = true;

      // Spawn NPCs and resolve entity IDs from npcMeta
      this._spawnAllNpcs();

      // Deferred: resolve entity IDs after worker processes spawns
      setTimeout(() => {
        this._resolveNpcEntityIds();
      }, 500);

      this._startFollowTick();
    } catch (error) {
      this.engineError = error instanceof Error ? error.message : String(error);
      this.debug('initializeEngine:error', { error: this.engineError });
    }
  }

  /** @inheritdoc */
  togglePartyMember(id: string): void {
    this.partyMembers = this.partyMembers.map((member) => {
      if (member.id !== id) {
        return member;
      }

      const newActive = !member.active;
      this.debug(newActive ? 'party-join' : 'party-leave', { id, name: member.name });

      // Zero velocity when leaving so the NPC doesn't keep drifting
      if (!newActive && member.eid > 0 && this._bridge) {
        this._bridge.send({
          type: 'SET_ENTITY_VELOCITY',
          entityId: member.eid,
          velocity: { x: 0, y: 0 },
        });
      }

      return { ...member, active: newActive };
    });
  }

  /** @inheritdoc */
  destroyEngine(): void {
    this._stopFollowTick();

    if (this._textureManager) {
      this._textureManager.destroy();
      this._textureManager = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    this._bridge = undefined;
    this.engineReady = false;
    this.mapLoaded = false;
    this.partyMembers = RECRUITABLE_NPCS.map((npc) => ({ ...npc, active: false, eid: 0 }));
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    this.destroyEngine();
    await super.dispose();
  }

  // -----------------------------------------------------------------------
  // Bridge listeners
  // -----------------------------------------------------------------------

  private _registerBridgeListeners(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    bridge.on('PLAYER_POSITION_CHANGED', (event) => {
      this._lastPlayerX = this.playerX;
      this._lastPlayerY = this.playerY;
      this.playerX = event.x;
      this.playerY = event.y;
    });

    bridge.on('MAP_LOADED', () => {
      this.debug('MAP_LOADED');
    });

    bridge.on('GAME_ERROR', (event) => {
      this.engineError = event.message;
    });
  }

  // -----------------------------------------------------------------------
  // NPC spawning & entity ID resolution
  // -----------------------------------------------------------------------

  /**
   * Spawns all recruitable NPCs via the engine bridge with LPC appearance
   * layer indices matching the sandbox recipes.
   */
  private _spawnAllNpcs(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    for (const npc of this.partyMembers) {
      bridge.send({
        type: 'SPAWN_NPC',
        npcData: {
          npcId: npc.id,
          npcName: npc.name,
          x: npc.spawnX,
          y: npc.spawnY,
          textureKey: 'npc_test',
          dialog: `${npc.name}: Ready to join your party!`,
          interactionRadius: 64,
          personaId: 'companion',
          relationshipValue: 0,
        },
      });
      this.debug('spawn-npc', { id: npc.id, name: npc.name });
    }
  }

  /**
   * Resolves ECS entity IDs for spawned NPCs by scanning the GameWorld's
   * npcMeta map. Called after the worker has processed SPAWN_NPC commands.
   */
  private _resolveNpcEntityIds(): void {
    const gw = this._gameWorld;
    if (!gw) {
      return;
    }

    const meta = (gw as unknown as { npcMeta: ReadonlyMap<number, { npcId: string }> }).npcMeta;

    this.partyMembers = this.partyMembers.map((member) => {
      if (member.eid > 0) {
        return member;
      }

      for (const [eid, entry] of meta) {
        if (entry.npcId === member.id) {
          this.debug('resolved-eid', { npcId: member.id, eid });
          return { ...member, eid };
        }
      }

      return member;
    });
  }

  // -----------------------------------------------------------------------
  // Follower velocity updates (C-212)
  // -----------------------------------------------------------------------

  private _startFollowTick(): void {
    this._followInterval = setInterval(() => {
      this._tickFollowVelocities();
    }, FOLLOW_TICK_MS);
  }

  private _stopFollowTick(): void {
    if (this._followInterval) {
      clearInterval(this._followInterval);
      this._followInterval = undefined;
    }
  }

  /**
   * On each tick, sends SET_ENTITY_VELOCITY for each active party member.
   *
   * Since the sandbox cannot read follower positions (they live in the
   * worker's bitECS world), velocity is derived from the player's movement
   * direction. Each follower mirrors the player's last movement direction
   * at FOLLOW_SPEED, scaled down when the player is stationary.
   *
   * The ECS movement_system applies collision detection, so followers
   * slide along walls and respect map boundaries. With 150ms updates,
   * followers naturally course-correct and converge near the player.
   */
  private _tickFollowVelocities(): void {
    const bridge = this._bridge;
    if (!bridge || !this.engineReady) {
      return;
    }

    this._resolveNpcEntityIds();

    const activeMembers = this.partyMembers.filter((m) => m.active && m.eid > 0);
    if (activeMembers.length === 0) {
      return;
    }

    // Compute player movement delta since last tick
    const pdx = this.playerX - this._lastPlayerX;
    const pdy = this.playerY - this._lastPlayerY;

    for (let i = 0; i < activeMembers.length; i++) {
      const member = activeMembers[i];
      const offset = FOLLOW_OFFSETS[i] ?? { dx: -40, dy: 0 };

      // Base velocity: mirror the player's movement direction.
      // When the player is moving, followers move in the same direction.
      let vx = pdx > 0 ? FOLLOW_SPEED : pdx < 0 ? -FOLLOW_SPEED : 0;
      let vy = pdy > 0 ? FOLLOW_SPEED : pdy < 0 ? -FOLLOW_SPEED : 0;

      // Add a small pull toward the offset target so followers spread out
      // and don't stack directly on the player.
      const targetX = this.playerX + offset.dx;
      const targetY = this.playerY + offset.dy;
      const odx = targetX - this.playerX;
      const ody = targetY - this.playerY;
      const oDist = Math.sqrt(odx * odx + ody * ody);
      if (oDist > 1) {
        // Small correction toward the offset position (10% of follow speed)
        vx += (odx / oDist) * FOLLOW_SPEED * 0.3;
        vy += (ody / oDist) * FOLLOW_SPEED * 0.3;
      }

      bridge.send({
        type: 'SET_ENTITY_VELOCITY',
        entityId: member.eid,
        velocity: { x: vx, y: vy },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getPartyFollowSandboxViewModel = (
  options: PartyFollowSandboxViewModelOptions,
): PartyFollowSandboxViewModel => {
  return new PartyFollowSandboxViewModel(options);
};
