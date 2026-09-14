// apps/frontend/client/src/lib/views/combat/combat_narration_flow.svelte.ts
//
// Outcome-narration + readable-intent presentation flow (C-526 AC-7, AC-10, AC-11).
//
// Extracted from the combat ViewModel (C-526 lifecycle repair) so the ~2,500-line
// ViewModel stops growing and this presentation concern stays reviewable on its own.
//
// Two guarantees drive the design:
//
//   1. LOG ORDERING survives out-of-order provider completion. The authored
//      template entry is appended SYNCHRONOUSLY the moment the engine resolves
//      a batch, which reserves its position in the log. The model's prose then
//      REPLACES that entry's text in place. A slow narrator therefore cannot
//      make turn 3's prose appear above turn 2's mechanics, and a failed
//      narrator leaves the already-correct template standing.
//   2. A late callback from an ENDED or RESTARTED encounter is ignored. The
//      guard is the encounter-run identity (generation + authored id), not the
//      authored encounter id alone — an authored id recurs on retry, so an
//      in-flight narration from the previous run would otherwise still match.
//
// Contract: C-526 AC-7, AC-10, AC-11

import type { EngineBridge } from '@aikami/frontend/engine';
import type { CombatNarrationRequest, CombatNarrationResult } from '@aikami/types';
import type { EncounterRunIdentity } from '../../services/game/combat_ai_lifecycle';
import { buildOutcomeNarration } from './combat_narration';

/** Everything the flow needs from its owning ViewModel. */
export type CombatNarrationFlowCapabilities = {
  /** The engine bridge, or `undefined` before `initialize()` completes. */
  bridge: () => EngineBridge | undefined;
  /** Pinned `PUBLIC_COMBAT_LLM_AGENTS` value; false ⇒ templates only (AC-9). */
  readonly enabled: boolean;
  /**
   * Narrates one resolved action. Never throws (template fallback).
   *
   * Optional: absent means the authored template is the only narration path —
   * exactly what the kill switch does. Telegraph and degradation presentation
   * must keep working in that mode, which is why the flow is always attached.
   */
  narrate?(request: CombatNarrationRequest): Promise<CombatNarrationResult>;
  /** Cancels every outstanding narration (encounter reset/end/disposal). */
  cancelAll(): void;
  /** The active encounter run, used to discard late callbacks. */
  currentRun: () => EncounterRunIdentity | undefined;
  /** Display name for a combatant id, for telegraph/degraded attribution. */
  displayNameFor(combatantId: string): string;
  /** Caches the engine-resolved names that travel with resolved events. */
  setCombatantNames(names: Record<string, string>): void;
  /** Appends a log entry synchronously and returns its id (order reservation). */
  appendLogEntry(options: { actionText: string; actor: string }): string;
  /** Rewrites an already-reserved log entry in place. */
  updateLogEntry(options: { entryId: string; actionText: string; actor: string }): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
};

export type CombatNarrationFlowInterface = {
  /** Subscribes to the presentation events; returns the disposer. */
  attach(): () => void;
  /** Drops outstanding narration and forgets run-local counters. */
  reset(): void;
};

/** Player-facing wording for each AI degradation reason (AC-7). */
const AI_DEGRADED_LABELS: Record<string, string> = {
  disabled: 'agent layer off',
  offline: 'no model available',
  timeout: 'model timed out',
  invalid: 'model reply unusable',
  stale: 'decision out of date',
  cancelled: 'turn cancelled',
};

/** Builds the narration/telegraph presentation flow for one combat ViewModel. */
export const createCombatNarrationFlow = (
  options: CombatNarrationFlowCapabilities,
): CombatNarrationFlowInterface => {
  let counter = 0;

  return {
    reset() {
      counter = 0;
      options.cancelAll();
    },

    attach(): () => void {
      const bridge = options.bridge();
      if (bridge === undefined) {
        // Nothing to subscribe to yet — the ViewModel attaches after
        // `initialize()`, so this is defensive only.
        return () => {};
      }
      const disposers: Array<() => void> = [];

      disposers.push(
        bridge.on('COMBAT_EVENTS_RESOLVED', (event) => {
          options.setCombatantNames(event.names);
          const run = options.currentRun();
          if (run === undefined) {
            // No active run: the batch belongs to an already-ended encounter.
            return;
          }
          const template = buildOutcomeNarration({ events: event.events, names: event.names });
          // Reserve the slot synchronously: this is what keeps the log ordered
          // when the model answers late.
          const entryId =
            template.length > 0
              ? options.appendLogEntry({ actionText: template, actor: 'System' })
              : undefined;
          const narrate = options.narrate;
          if (!options.enabled || narrate === undefined) {
            return;
          }

          counter += 1;
          const revision = event.events.at(-1)?.stateRevision ?? 0;
          const narrationId = `${run.generation}:narration:${revision}:${counter}`;
          void narrate({
            narrationId,
            encounterId: run.encounterId,
            basedOnRevision: revision,
            events: event.events,
            names: event.names,
          })
            .then((result) => {
              if (!isSameRun(options.currentRun(), run)) {
                return;
              }
              const text = result.text.length > 0 ? result.text : template;
              if (text.length === 0) {
                return;
              }
              const actor = result.source === 'llm' ? 'Narrator' : 'System';
              if (entryId === undefined) {
                options.appendLogEntry({ actionText: text, actor });
                return;
              }
              options.updateLogEntry({ entryId, actionText: text, actor });
            })
            .catch(() => {
              // The service never rejects; this is belt-and-braces so a
              // narration failure can never surface as an unhandled rejection.
              // The reserved template entry already stands.
            });
        }),
      );

      // AC-7: readable intent and AI degradation are presentation only — they
      // add no mechanics and never commit a command. The engine de-duplicates
      // `COMBAT_AI_DEGRADED` per `(actor, reason)`, so the log gains one entry
      // per actor and reason instead of one per action.
      disposers.push(
        bridge.on('COMBAT_INTENT_TELEGRAPHED', (event) => {
          if (event.line.length === 0) {
            return;
          }
          options.appendLogEntry({
            actionText: `Intent — ${event.line}`,
            actor: options.displayNameFor(event.actorId),
          });
        }),
      );

      disposers.push(
        bridge.on('COMBAT_AI_DEGRADED', (event) => {
          const label = AI_DEGRADED_LABELS[event.reason] ?? event.reason;
          options.appendLogEntry({
            actionText: `Deterministic AI — ${label}`,
            actor: options.displayNameFor(event.actorId),
          });
        }),
      );

      return () => {
        for (const dispose of disposers) {
          dispose();
        }
      };
    },
  };
};

/** Whether `candidate` is still the same encounter run as `expected`. */
const isSameRun = (
  candidate: EncounterRunIdentity | undefined,
  expected: EncounterRunIdentity,
): boolean =>
  candidate !== undefined &&
  candidate.generation === expected.generation &&
  candidate.encounterId === expected.encounterId;
