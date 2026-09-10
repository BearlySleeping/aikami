// apps/frontend/client/src/lib/services/game/companion_reaction_service.svelte.ts
//
// Companion reaction service (C-494 AC-4, AC-5) — the single reaction authority
// for a recruited companion. It sits on the dialogue consequence/event seam:
// when a committed narrative event (or an action description) crosses one of
// the companion's authored boundaries, it applies the authored reaction as a
// real state change (approval drop via `adjustApproval`, or `dismiss` for
// "leaving") — never prose-only. AC-5's single unprompted action is keyed to a
// witnessed event and fired exactly once (idempotency keyed to the event id).
//
// Design notes:
//   - The reaction vocabulary lives in the pack (`reaction|trigger` inside
//     `boundaries`); this service only performs the mechanical state mutation.
//   - Reactions are keyed to the triggering event/operation identity so a
//     retry cannot double-drop approval or double-dismiss (C-489 discipline).
//   - It never fires for NPCs that are not recruited companions.
//
// Persistence: roster membership, approval, and witnessed events all round-trip
// through their existing serializable services (AC-6).

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { CommittedNarrativeEvent, ContentPackNpcEntry } from '@aikami/types';
import {
  applyCompanionReaction,
  type CompanionReactionKind,
  detectBoundaryCrossing,
  type ParsedCompanionReaction,
} from './companion_reaction';
import { partyRosterService } from './party_roster_service.svelte';

export type CompanionReactionServiceOptions = BaseFrontendClassOptions;

export type CompanionReactionServiceInterface = BaseFrontendClassInterface & {
  /**
   * Evaluates a committed narrative event against the companion's authored
   * boundaries. When the event crosses a boundary, applies the authored
   * reaction as a state change. Idempotent per event id.
   *
   * @returns the applied reaction, or undefined when nothing fired.
   */
  evaluateEvent(options: {
    npcId: string;
    npc: ContentPackNpcEntry | undefined;
    event: CommittedNarrativeEvent;
  }): { reaction: CompanionReactionKind; binding: ParsedCompanionReaction } | undefined;

  /**
   * AC-5: a scripted unprompted companion turn keyed to a witnessed event.
   * Fires exactly once per event id. Returns true when it fired.
   */
  fireUnpromptedTurn(options: {
    npcId: string;
    npc: ContentPackNpcEntry | undefined;
    event: CommittedNarrativeEvent;
  }): boolean;

  /** Whether a reaction/unprompted action has already fired for this event. */
  hasFired(eventId: string): boolean;

  /** Clears the idempotency ledger (used by tests / session reset). */
  reset(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class CompanionReactionService
  extends BaseFrontendClass<CompanionReactionServiceOptions>
  implements CompanionReactionServiceInterface
{
  /** Idempotency ledger: eventId → fired reactions (C-489/C-494 discipline). */
  private _fired = new Set<string>();

  /** @inheritdoc */
  evaluateEvent(options: {
    npcId: string;
    npc: ContentPackNpcEntry | undefined;
    event: CommittedNarrativeEvent;
  }): { reaction: CompanionReactionKind; binding: ParsedCompanionReaction } | undefined {
    const { npcId, npc, event } = options;

    // Gate: only a recruited companion reacts, and only via authored boundaries.
    if (!npc?.isCompanion || !partyRosterService.hasMember(npcId)) {
      return undefined;
    }
    if (this._fired.has(event.id)) {
      this.debug('evaluateEvent:already-fired', { eventId: event.id });
      return undefined;
    }

    const crossing = detectBoundaryCrossing({
      boundaries: npc.boundaries,
      actionDescription: event.summary,
    });
    if (!crossing) {
      return undefined;
    }

    const outcome = applyCompanionReaction({
      npcId,
      reaction: crossing.reaction,
      roster: partyRosterService,
    });
    this._fired.add(event.id);

    this.info('companion:reaction', {
      npcId,
      eventId: event.id,
      eventKind: event.kind,
      trigger: crossing.trigger,
      reaction: crossing.reaction,
      approvalDelta: outcome.approvalDelta,
      dismissed: outcome.dismissed,
    });

    return { reaction: crossing.reaction, binding: crossing };
  }

  /** @inheritdoc */
  fireUnpromptedTurn(options: {
    npcId: string;
    npc: ContentPackNpcEntry | undefined;
    event: CommittedNarrativeEvent;
  }): boolean {
    const { npcId, npc, event } = options;

    // Only a recruited companion can act unprompted.
    if (!npc?.isCompanion || !partyRosterService.hasMember(npcId)) {
      return false;
    }
    // Fires exactly once per event (idempotency — no double action).
    if (this._fired.has(event.id)) {
      this.debug('fireUnpromptedTurn:already-fired', { eventId: event.id });
      return false;
    }

    this._fired.add(event.id);
    this.info('companion:unprompted', {
      npcId,
      eventId: event.id,
      eventKind: event.kind,
      summary: event.summary,
    });
    return true;
  }

  /** @inheritdoc */
  hasFired(eventId: string): boolean {
    return this._fired.has(eventId);
  }

  /** @inheritdoc */
  reset(): void {
    this._fired.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const companionReactionService: CompanionReactionServiceInterface =
  CompanionReactionService.create({
    className: 'CompanionReactionService',
  });
