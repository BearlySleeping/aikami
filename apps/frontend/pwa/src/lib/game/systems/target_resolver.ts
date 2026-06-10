// apps/frontend/pwa/src/lib/game/systems/target_resolver.ts

import type { Container } from 'pixi.js';

// ---------------------------------------------------------------------------
// TargetResolver — maps NPC string IDs to PixiJS DisplayObject references
//
// When the Stream Orchestrator's Texture Injector needs to apply a
// generated texture to an NPC's sprite, it calls `resolveTarget(npcId)`
// to obtain the Concrete PixiJS `Container` for that NPC.
//
// The resolver wraps the GameWorld's internal NPC metadata and render
// entry maps, providing a focused, testable API that hides the ECS
// entity-ID indirection.
// ---------------------------------------------------------------------------

/** Minimal NPC metadata needed for target resolution. */
type NpcMetaEntry = {
  eid: number;
  npcId: string;
};

/** Render entry shape from GameWorld. */
type RenderEntry = {
  displayObject: Container;
  tint: number;
  cullable: boolean;
};

/**
 * Source of NPC metadata and render entries.
 *
 * In production this is backed by GameWorld's internal `npcMeta` and
 * `renderEntries` maps. Tests inject a plain `Map` directly.
 */
export type TargetResolverSource = {
  /** Retrieves NPC metadata by entity ID. */
  getNpcMeta(eid: number): NpcMetaEntry | undefined;

  /** Retrieves the PixiJS display object by entity ID. */
  getRenderEntry(eid: number): RenderEntry | undefined;

  /** Iterates all registered NPC entity IDs. */
  getNpcEntityIds(): Iterable<number>;
};

export type TargetResolverOptions = {
  source: TargetResolverSource;
};

/**
 * Resolves an NPC's string ID to its PixiJS DisplayObject.
 *
 * Walks the source's NPC metadata store to find the entity ID matching
 * the given `npcId`, then returns the associated `Container` from the
 * render entry store.
 *
 * **Graceful degradation**: if no NPC metadata or no render entry exists
 * for the given ID, returns `undefined` without throwing. The caller
 * (Texture Injector) should skip image injection for missing sprites.
 */
export class TargetResolver {
  private readonly _source: TargetResolverSource;

  constructor(options: TargetResolverOptions) {
    this._source = options.source;
  }

  /**
   * Resolves an NPC string ID to its PixiJS DisplayObject.
   *
   * @param npcId - The NPC's unique string identifier (e.g. "npc-elder-001").
   * @returns The PixiJS `Container` if found, or `undefined` if the NPC
   *          has no visual representation loaded yet.
   */
  resolveTarget(npcId: string): Container | undefined {
    // Walk all NPC metadata entries to find the matching npcId
    for (const eid of this._source.getNpcEntityIds()) {
      const meta = this._source.getNpcMeta(eid);
      if (meta && meta.npcId === npcId) {
        const entry = this._source.getRenderEntry(meta.eid);
        return entry?.displayObject;
      }
    }

    return undefined;
  }
}
