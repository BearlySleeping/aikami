// packages/frontend/engine/src/combat/combat_v2_reaction_policy.ts
//
// The engine-owned deterministic reaction policy (review F8).
//
// Before this module the Ask / Auto / Never policy lived entirely in the client
// reaction flow. An opportunity attack is only ever offered to an actor HOSTILE
// to the mover — and hostiles are never player-controlled — so an enemy window
// was resolved by nothing at all when no decision surface was mounted: the
// encounter stayed in phase 'reaction' forever.
//
// The engine now decides. A reactor the player controls with an authored `ask`
// policy is left for the surface (human choice is presentation); everything else
// — an enemy, an `auto`/`never` policy, an actor the player does not control —
// resolves here, deterministically, through the SAME kernel command path a
// client decision uses. No model call, no UI, no timer.
//
// The commit function is INJECTED so this module never imports the resolver
// back: the resolver imports this module, and the module graph stays acyclic.
//
// Contract: C-532 AC-3

import type { CombatCommand, CombatState, ReactionChoice } from '@aikami/types';
import type { World } from 'bitecs';
import { logger } from '$logger';
import type { EngineBridge } from '../engine_bridge.ts';
import { engineReactionPolicyFor } from './combat_v2_events.ts';
import type { ResolveV2CombatCommandResult } from './combat_v2_resolver.ts';

/**
 * Maximum engine-owned reaction decisions per drain.
 *
 * A window can advance to the next queued reactor and a resumed move can open a
 * new window, so the drain is a loop rather than a single step. The bound is
 * what keeps a pathological authored queue from spinning.
 */
const MAX_ENGINE_REACTION_STEPS = 64;

/** Per-world re-entrancy guard so a nested commit cannot re-enter the drain. */
const drainingReactionPolicies = new WeakSet<World>();

/**
 * Resolves every open reaction window whose current reactor is governed by an
 * ENGINE-owned policy (C-532 AC-3; review F8).
 *
 * A reactor the player controls with an authored `ask` policy is left for the
 * decision surface: human choice is presentation, not mechanics. Everything
 * else — an enemy, an `auto`/`never` policy, an actor the player does not
 * control — resolves here, deterministically, through the SAME kernel command
 * path a client decision uses. No model call, no UI, no timer.
 */
export const resolveEngineReactionPolicies = (options: {
  world: World;
  bridge: EngineBridge;
  /** The live authoritative state, or `null` between encounters. */
  readState(): CombatState | null;
  /** Commits one engine-owned reaction through the single commit path. */
  commit(
    command: Extract<CombatCommand, { kind: 'resolveReaction' }>,
  ): ResolveV2CombatCommandResult;
}): void => {
  const { world, readState, commit } = options;
  if (drainingReactionPolicies.has(world)) {
    return;
  }
  drainingReactionPolicies.add(world);
  try {
    for (let step = 0; step < MAX_ENGINE_REACTION_STEPS; step++) {
      const state = readState();
      if (state === null || state.phase !== 'reaction') {
        return;
      }
      const window = state.reaction.windows.find((entry) => entry.status === 'open');
      if (window === undefined) {
        return;
      }
      const reactorId = window.currentReactorId ?? window.reactorQueue[0];
      if (reactorId === undefined) {
        return;
      }
      const policy = engineReactionPolicyFor(state, reactorId);
      if (policy === 'ask') {
        // A human decision is required; the surface owns it from here.
        return;
      }
      const choice: ReactionChoice = policy === 'auto' ? 'accept' : 'decline';
      const resolved = commit({
        kind: 'resolveReaction',
        combatantId: reactorId,
        encounterRunId: state.encounterRunId,
        windowId: window.windowId,
        windowVersion: window.version,
        choice,
        source: 'ai_policy',
      });
      if (!resolved.ok) {
        logger.warn('combat:engine-reaction-policy-refused', {
          encounterId: state.encounterId,
          reactorId,
          reasonCode: resolved.reasonCode,
        });
        return;
      }
    }
    logger.warn('combat:engine-reaction-policy-drain-exhausted', {
      encounterId: readState()?.encounterId ?? '',
      maxSteps: MAX_ENGINE_REACTION_STEPS,
    });
  } finally {
    drainingReactionPolicies.delete(world);
  }
};
