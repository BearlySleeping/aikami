// packages/frontend/engine/src/game_world/actor_visual_transport.ts
//
// How an authored actor's visual reaches the renderer.
//
// The engine never learns an NPC's appearance from mechanical combat state: a
// combatant carries its authored `npcId`, a resolver turns that id into the
// pack's own `ActorVisual`, and only then does the renderer choose a path. A
// pack actor that names ONE image is loaded as that image; every other actor
// composes LPC layers exactly as before.
//
// Extracted from `game_world.ts` — that file is at its reviewed size ceiling,
// and this is a self-contained responsibility: it reads a loader, a render
// entry, a revision counter and a URL resolver, and touches nothing else.

import type { StaticVisual } from '@aikami/schemas';
import type { EntityAppearanceLoader, PreparedAppearance } from './entity_appearance.ts';
import type { RenderEntry } from './render_entry.ts';

/** The world state one appearance commit must consult. */
export type AppearanceCommitContext = {
  loader: EntityAppearanceLoader;
  /** True once the world has been torn down. */
  isDisposed: () => boolean;
  /** The revision counter for this entity, read at commit time. */
  currentRevision: () => number;
  debug: (event: string, data: Record<string, unknown>) => void;
};

/**
 * Commits a prepared appearance, or discards it.
 *
 * Aborts when the entity was replaced, the world was torn down, a newer load
 * started, or nothing resolved — in every case the existing display object is
 * kept rather than blanked, so replacement is atomic and a superseded load
 * never leaves a hole.
 */
export const commitPreparedAppearance = (options: {
  context: AppearanceCommitContext;
  /** The entry the load started against; a different one now means it moved. */
  entry: RenderEntry;
  /** The entry currently registered for this entity. */
  currentEntry: RenderEntry | undefined;
  prepared: PreparedAppearance;
  revision: number;
  debugEvent: string;
}): boolean => {
  const { context, entry, currentEntry, prepared, revision } = options;
  if (context.isDisposed() || currentEntry !== entry) {
    context.loader.disposePrepared(prepared);
    return false;
  }
  const currentRevision = context.currentRevision();
  if (revision < currentRevision) {
    context.debug(`${options.debugEvent}-stale`, { revision, currentRevision });
    context.loader.disposePrepared(prepared);
    return false;
  }
  // No texture resolved — keep the existing placeholder rather than replacing
  // it with nothing.
  if (prepared.layers.length === 0) {
    context.loader.disposePrepared(prepared);
    return false;
  }
  context.loader.commit({
    target: entry.displayObject,
    prepared,
  });
  entry.layerSprites = prepared.layers;
  context.debug(options.debugEvent, { layers: prepared.layers.length });
  return true;
};

/**
 * Loads ONE authored image as an actor's whole visual.
 *
 * The URL is resolved through the SAME registry-backed tag resolver the rest of
 * the world uses, so a pack image resolves to its published object and a miss
 * degrades to the raw URL rather than to a broken sprite.
 */
export const loadStaticVisual = async (options: {
  context: AppearanceCommitContext;
  entry: RenderEntry;
  currentEntry: RenderEntry | undefined;
  visual: StaticVisual;
  revision: number;
  /** Registry-backed tag resolver, or undefined when none is wired. */
  resolveUrl: ((url: string) => string | null) | undefined;
}): Promise<boolean> => {
  const { context, entry, currentEntry, visual, revision } = options;
  const url = options.resolveUrl?.(visual.url) ?? visual.url;
  const prepared = await context.loader.prepareStatic({
    url,
    width: visual.width,
    height: visual.height,
    ...(visual.anchorY === undefined ? {} : { anchorY: visual.anchorY }),
    id: `static:${visual.url}`,
  });
  return commitPreparedAppearance({
    context,
    entry,
    currentEntry,
    prepared,
    revision,
    debugEvent: 'static-visual-loaded',
  });
};
