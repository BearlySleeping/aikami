// apps/frontend/client/src/lib/views/dev/sandbox/party_follow/party_follow_sandbox_view_model.svelte.ts
//
// ViewModel for the isolated Party Follow sandbox route.
// Creates a GameWorld with a player and recruitable LPC NPC companions.
// Uses the ECS party_follow_system (A* → PathFollow → Velocity) for
// companion locomotion — the client only sends SET_COMPANION_RECRUITED.
//
// Contract: C-212 Party Follow System, C-340 Build Party and Companion Gameplay

import type { EngineBridge, GameWorldOptions } from '@aikami/frontend/engine';
import { createEngineBridge, GameWorld, TextureManager } from '@aikami/frontend/engine';
import { projectLpcCatalog } from '@aikami/frontend/engine/content';
import type { AssetTagResolver } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { LpcAnimationState } from '@aikami/lpc';
import { getLpcAssetPath, getLpcCatalog } from '$lib/data/lpc_asset_catalog';
import { sandboxRecipeResolver } from '../shared/lpc_sandbox_resolver';

// ---------------------------------------------------------------------------
// Lazily-resolved ECS worker constructor (SSR-safe dynamic import)
// ---------------------------------------------------------------------------

let _ecsWorkerCtor: (new () => Worker) | undefined;

const _resolveEcsWorker = async (): Promise<new () => Worker> => {
  if (_ecsWorkerCtor) {
    return _ecsWorkerCtor;
  }
  const mod = await import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module');
  _ecsWorkerCtor = mod.default as unknown as new () => Worker; // guard-ignore lint/type-safety/casting: LPC animation state enum cast - value guaranteed by upstream
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
  /** ECS entity ID (resolved from ENTITY_CREATED or npcMeta after spawn). */
  eid: number;
  /** 6-element LPC appearance layer array (engine variant indices). */
  readonly appearanceLayers: readonly [number, number, number, number, number, number];
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

const PLAYER_SPAWN_X = 160;
const PLAYER_SPAWN_Y = 192;

/**
 * Recruitable NPCs with per-companion appearance layers.
 * Engine variant indices (1-indexed) in slot order: body, hair, torso, legs, feet, head.
 */
const RECRUITABLE_NPCS: Omit<PartyMember, 'active' | 'eid'>[] = [
  {
    id: 'companion-lydia',
    name: 'Lydia',
    spawnX: 256,
    spawnY: 192,
    appearanceLayers: [10, 11, 14, 12, 15, 13], // bodies_female, long_adult, chainmail_female, pants_female, shoes_female, human_female
  },
  {
    id: 'companion-bjorn',
    name: 'Bjorn',
    spawnX: 160,
    spawnY: 288,
    appearanceLayers: [3, 3, 24, 22, 7, 95], // bodies_male, bangs, leather_male, pants_male, boots_male, human_male
  },
  {
    id: 'companion-mira',
    name: 'Mira',
    spawnX: 224,
    spawnY: 256,
    appearanceLayers: [10, 11, 34, 12, 15, 13], // bodies_female, long_adult, robes_female, pants_female, shoes_female, human_female
  },
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

  partyMembers: PartyMember[] = $state(
    RECRUITABLE_NPCS.map((npc) => ({ ...npc, active: false, eid: 0 })),
  );

  get activeCount(): number {
    return this.partyMembers.filter((m) => m.active).length;
  }

  private _gameWorld: GameWorld | undefined;
  private _bridge: EngineBridge | undefined;
  private _assetTagResolver: AssetTagResolver | undefined;
  private _releaseUrl: ((url: string) => void) | undefined;
  private _textureManager: TextureManager | undefined;
  private _initializationGeneration = 0;
  private _isInitializing = false;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    if (this._gameWorld || this._isInitializing) {
      return;
    }

    const initializationGeneration = ++this._initializationGeneration;
    this._isInitializing = true;

    try {
      const workerCtor = await _resolveEcsWorker();
      if (!this._isInitializationActive(initializationGeneration)) {
        return;
      }

      this._bridge = createEngineBridge();
      this._textureManager = new TextureManager({});

      const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
      if (!this._isInitializationActive(initializationGeneration)) {
        return;
      }
      const { assetManager } = await import('$lib/services/assets/asset_manager.svelte');
      if (!this._isInitializationActive(initializationGeneration)) {
        return;
      }
      this._assetTagResolver = assetTagResolver;
      this._releaseUrl = (url: string) => assetManager.releaseUrl(url);

      // C-400: project the real LPC catalog and pass it to the worker so
      // both threads resolve appearance layers identically.
      const lpcCatalog = projectLpcCatalog(getLpcCatalog().slots);
      const bridge = this._bridge;
      const textureManager = this._textureManager;
      if (!bridge || !textureManager || !this._isInitializationActive(initializationGeneration)) {
        return;
      }

      const worldOptions: GameWorldOptions = {
        className: 'PartyFollowSandboxGameWorld',
        bridge,
        workerFactory: () => new workerCtor(),
        recipeResolver: sandboxRecipeResolver,
        lpcCatalog,
        assetUrlResolver: (slot, assetId, state) =>
          getLpcAssetPath(slot, assetId, state as unknown as LpcAnimationState), // guard-ignore lint/type-safety/casting: LPC animation state enum cast - value guaranteed by upstream
        textureManager,
        // C-434: registry-backed tag resolver for maps and tilesets.
        resolveTag: this._assetTagResolver,
        releaseUrl: this._releaseUrl,
      };

      this._gameWorld = GameWorld.create(worldOptions);

      await this._gameWorld.initialize({
        canvas,
        playerData: { name: 'Adventurer' },
      });
      if (!this._isInitializationActive(initializationGeneration)) {
        return;
      }

      this._registerBridgeListeners();

      // Load the content pack through the asset manager (R2-backed registry)
      const { loadContentPack } = await import('@aikami/frontend/engine');
      if (!this._isInitializationActive(initializationGeneration)) {
        return;
      }

      const pack = await loadContentPack({
        packId: 'emberwatch',
        resolveTag: this._assetTagResolver,
        releaseUrl: this._releaseUrl,
      });

      // Re-check after async gap — the GameWorld may have been destroyed.
      if (!this._gameWorld || !this._isInitializationActive(initializationGeneration)) {
        return;
      }

      await this._gameWorld.loadMap({
        mapUrl: pack.resolveMapUrl('village'),
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
    } catch (error) {
      if (!this._isInitializationActive(initializationGeneration)) {
        return;
      }

      const engineError = error instanceof Error ? error.message : String(error);
      this.destroyEngine();
      this.engineError = engineError;
      this.debug('initializeEngine:error', { error: this.engineError });
    } finally {
      if (this._initializationGeneration === initializationGeneration) {
        this._isInitializing = false;
      }
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

      // Send SET_COMPANION_RECRUITED to the ECS worker — the party_follow_system
      // handles all locomotion via A* → PathFollow → Velocity.
      if (member.eid > 0 && this._bridge) {
        this._bridge.send({
          type: 'SET_COMPANION_RECRUITED',
          entityId: member.eid,
          recruited: newActive,
        });
      }

      return { ...member, active: newActive };
    });
  }

  /** @inheritdoc */
  destroyEngine(): void {
    this._initializationGeneration++;
    this._isInitializing = false;

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

  private _isInitializationActive(initializationGeneration: number): boolean {
    return this._isInitializing && this._initializationGeneration === initializationGeneration;
  }

  private _registerBridgeListeners(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    bridge.on('PLAYER_POSITION_CHANGED', (event) => {
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
   * Spawns all recruitable NPCs via the engine bridge with per-companion
   * appearance layers and isCompanion: true so the ECS attaches the
   * Companion component and spatial collision.
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
          appearanceLayers: npc.appearanceLayers,
          isCompanion: true,
        },
      });
      this.debug('spawn-npc', { id: npc.id, name: npc.name });
    }
  }

  /**
   * Resolves ECS entity IDs for spawned NPCs by scanning the GameWorld's
   * public npcMeta map. Called after the worker has processed SPAWN_NPC commands.
   */
  private _resolveNpcEntityIds(): void {
    const gw = this._gameWorld;
    if (!gw) {
      return;
    }

    this.partyMembers = this.partyMembers.map((member) => {
      if (member.eid > 0) {
        return member;
      }

      for (const [eid, entry] of gw.npcMeta) {
        if (entry.npcId === member.id) {
          this.debug('resolved-eid', { npcId: member.id, eid });

          if (member.active && this._bridge) {
            this._bridge.send({
              type: 'SET_COMPANION_RECRUITED',
              entityId: eid,
              recruited: true,
            });
          }

          return { ...member, eid };
        }
      }

      return member;
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getPartyFollowSandboxViewModel = (
  options: PartyFollowSandboxViewModelOptions,
): PartyFollowSandboxViewModel => PartyFollowSandboxViewModel.create(options);
