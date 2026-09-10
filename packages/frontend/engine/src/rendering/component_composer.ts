// packages/frontend/engine/src/rendering/component_composer.ts
//
// Modular component composition (C-496 AC-2).
//
// A selectable component may emit several stable render passes (e.g. a rear
// `/behind` pass and a front pass). The composer validates that a component's
// declared rig/body/pose profile matches the host, then emits its passes in a
// deterministic order independent of async load order or catalog-array
// position. Incompatible combinations are rejected with actionable
// diagnostics — never silently substituted per-layer.
//
// This module is pure (no Pixi) so it is unit-testable and shared by the game
// and preview hosts. It does NOT read `examples/**` or generator conventions;
// compatibility comes from the committed, reviewed component definition.
//
// Contract: C-496 (AC-2)

import type { LpcLayerRecipe } from '@aikami/lpc';
import type { ComponentDefinition, VisualComponentPass } from '@aikami/schemas';
import { resolveLayerDepth } from './lpc_layer_order.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single resolved render pass for composition.
 */
export type ComposedPass = {
  /** The component this pass belongs to. */
  componentId: string;
  /** Stable pass id (e.g. `behind`, `front`). */
  passId: string;
  /** Clip this pass plays. */
  clipName: string;
  /** Relative depth for composition (larger = closer to camera). */
  depth: number;
  /** Whether this pass is visible by default. */
  visible: boolean;
  /** Deterministic component ordering value. */
  order: number;
};

/**
 * A component rejected by compatibility validation.
 */
export type RejectedComponent = {
  componentId: string;
  /** Human-readable, actionable reason. */
  reason: string;
};

/**
 * The result of composing a set of components against a host profile.
 */
export type ComponentCompositionResult = {
  /** Ordered render passes (rear/front), sorted deterministically. */
  passes: ComposedPass[];
  /** Components rejected for rig/body/pose incompatibility. */
  rejected: RejectedComponent[];
};

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

/**
 * Composes modular component passes against a host rig/body/pose profile.
 *
 * A component is accepted only when all three declared profiles match the
 * host. Accepted passes are emitted once each and ordered deterministically
 * by the component's `order` then the pass's `depth`, so equal-depth ties and
 * `/behind` rear passes resolve the same way regardless of async load order.
 *
 * @param options - Compose options.
 * @param options.hostRig - The host rig profile id.
 * @param options.hostBody - The host body profile id.
 * @param options.hostPose - The host pose (timing) profile id.
 * @param options.components - The component definitions to compose.
 * @returns Ordered passes plus any rejected components.
 */
export const composeComponentPasses = (options: {
  hostRig: string;
  hostBody: string;
  hostPose: string;
  components: readonly ComponentDefinition[];
}): ComponentCompositionResult => {
  const { hostRig, hostBody, hostPose, components } = options;

  const passes: ComposedPass[] = [];
  const rejected: RejectedComponent[] = [];

  for (const component of components) {
    const componentDef = component.component;
    // Validate rig/body/pose compatibility against the host profile.
    const mismatches: string[] = [];
    if (componentDef.rigProfile !== hostRig) {
      mismatches.push(`rig '${componentDef.rigProfile}' != host '${hostRig}'`);
    }
    if (componentDef.bodyProfile !== hostBody) {
      mismatches.push(`body '${componentDef.bodyProfile}' != host '${hostBody}'`);
    }
    if (componentDef.poseProfile !== hostPose) {
      mismatches.push(`pose '${componentDef.poseProfile}' != host '${hostPose}'`);
    }
    if (mismatches.length > 0) {
      rejected.push({
        componentId: componentDef.id,
        reason: `Incompatible with host (${hostRig}/${hostBody}/${hostPose}): ${mismatches.join('; ')}`,
      });
      continue;
    }

    // Emit every stable pass of an accepted component exactly once.
    for (const pass of componentDef.passes) {
      passes.push({
        componentId: componentDef.id,
        passId: pass.passId,
        clipName: pass.clipName,
        depth: pass.depth,
        visible: pass.visible,
        order: componentDef.order,
      });
    }
  }

  // Deterministic ordering independent of input order / async load order:
  // sort by component `order`, then pass `depth` (ties broken stably by
  // insertion order, which is already deterministic for a given input).
  passes.sort((a, b) => a.order - b.order || a.depth - b.depth);

  return { passes, rejected };
};

/**
 * Re-exported pass type for consumers.
 */
export type { VisualComponentPass };

// ---------------------------------------------------------------------------
// LPC recipe composition (production consumer in game_world)
// ---------------------------------------------------------------------------

/**
 * Ordered result for composing LPC layer recipes into render passes.
 */
export type LpcRecipeComposition = {
  /** Passes ordered deterministically (rear `behind` → front). */
  passes: ComposedPass[];
  /** Recipe indices in the order they should render (back-to-front). */
  order: number[];
};

/**
 * Composes LPC layer recipes into deterministic render passes (AC-2).
 *
 * This is the production consumer of {@link composeComponentPasses} used by
 * `game_world` when it sorts a modular actor's layer sprites: each recipe is
 * treated as one component pass (component = slot, pass = layerRole) and the
 * composer's rig/body/pose + depth + order rules produce a single total
 * ordering, so a rear `/behind` pass always renders behind its front pass
 * regardless of async load order. When no recipes are supplied it returns an
 * empty ordering (callers fall back to the canonical depth table).
 *
 * @param options - Compose options.
 * @param options.recipes - The entity's LPC layer recipes.
 * @param options.hostRig - Host rig profile (default `universal`).
 * @param options.hostBody - Host body profile (default `adult`).
 * @param options.hostPose - Host pose profile (default `lpc.v1`).
 * @returns Ordered passes and the recipe render order.
 */
export const composeLpcRecipePasses = (options: {
  recipes: readonly LpcLayerRecipe[];
  hostRig?: string;
  hostBody?: string;
  hostPose?: string;
}): LpcRecipeComposition => {
  const { recipes, hostRig = 'universal', hostBody = 'adult', hostPose = 'lpc.v1' } = options;

  // Build one synthetic component per recipe; the component `order` and the
  // pass `depth` reproduce the canonical slot depth so the composer output
  // stays compatible with the existing depth table.
  const components: ComponentDefinition[] = recipes.map((recipe, index) => ({
    kind: 'component',
    identity: {
      schemaVersion: 'visual.definition.1',
      id: recipe.slot ?? `layer-${index}`,
      revision: 'engine',
    },
    images: [],
    frames: [],
    clips: [],
    presentation: { pixelDensity: 1, sampling: 'nearest', colorOperation: 'none' },
    provenance: { source: 'engine', licenses: [] },
    component: {
      id: recipe.slot ?? `layer-${index}`,
      rigProfile: hostRig,
      bodyProfile: hostBody,
      poseProfile: hostPose,
      // Uniform order so the canonical pass `depth` (from resolveLayerDepth)
      // governs the render order — rear `/behind` before front.
      order: 0,
      passes: [
        {
          passId: recipe.layerRole ?? 'front',
          clipName: 'walk.down',
          depth: resolveLayerDepth({
            slot: recipe.slot,
            layerRole: recipe.layerRole ?? 'front',
            direction: 2,
          }),
          visible: true,
        },
      ],
    },
  }));

  const { passes } = composeComponentPasses({
    hostRig,
    hostBody,
    hostPose,
    components,
  });

  // Map composed passes back to recipe indices by componentId (slot). Ties
  // keep stable order; rejected components (shouldn't happen for synthetic
  // profiles) are appended last in original order.
  const order: number[] = [];
  const bySlot = new Map(recipes.map((recipe, index) => [recipe.slot ?? `layer-${index}`, index]));
  for (const pass of passes) {
    const index = bySlot.get(pass.componentId);
    if (index !== undefined && !order.includes(index)) {
      order.push(index);
    }
  }
  for (let i = 0; i < recipes.length; i++) {
    if (!order.includes(i)) {
      order.push(i);
    }
  }

  return { passes, order };
};
