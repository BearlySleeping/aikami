// apps/frontend/client/src/lib/services/game/narrative_event_service.svelte.ts
//
// Committed narrative event record service — owns the append-only, closed-kind
// event list and participates in save/load through the serializable-service
// registry. Every consequential resolution that the C-489 authority or the
// quest/promise paths commit writes exactly one event here, tagged with its
// witnesses and information category.
//
// This is a narrowly scoped append-only record, NOT event sourcing: there is
// one append API (`record`), no replay/rebuild, and no projection engine. The
// snapshot rides inside `serviceSnapshots` like every other serializable
// service.
//
// Contract: C-491 Committed narrative event record

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { CommittedNarrativeEventSchema } from '@aikami/schemas';
import type {
  CommittedNarrativeEvent,
  NarrativeEventKind,
  NarrativeEventRecord,
  NarrativeInformationKind,
  NpcStateDelta,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { registerSerializable } from './serializable_service';

/** Options for a single committed narrative event — single-use type for `record()` (S10). */
type RecordEventOptions = {
  /** Campaign the event belongs to — required, never empty. */
  campaignId: string;
  /** One of the closed event-kind set. */
  kind: NarrativeEventKind;
  /** world_fact | character_belief | dialogue_claim. */
  informationKind: NarrativeInformationKind;
  /** Human-readable summary of what happened. */
  summary: string;
  /** Entity the event is about (NPC id, faction id, item id, quest id). */
  subjectId?: string;
  /** For character_belief / dialogue_claim: who holds or asserts the information. */
  claimantId?: string;
  /** The acting NPC — always added to the witness set. */
  actorId?: string;
  /** Additional nearby NPC ids from the scene cast. */
  witnesses?: readonly string[];
  /** Link to the C-489 operation/source-event identity when sourced from dialogue. */
  sourceEventId?: string;
  /** The applied deltas this event summarises (audit trail). */
  deltasApplied?: readonly NpcStateDelta[];
};

type NarrativeEventHydrationPayload = {
  events: CommittedNarrativeEvent[];
  nextSequence?: number;
};

/** Construction options for the narrative event record singleton. */
export type NarrativeEventServiceOptions = BaseFrontendClassOptions;

/** Public contract for the committed narrative event record. */
export type NarrativeEventServiceInterface = BaseFrontendClassInterface & {
  /** The ordered event list, oldest first. */
  readonly events: readonly CommittedNarrativeEvent[];
  /**
   * Appends exactly one event, assigning the next monotonic `sequence`. Never
   * mutates or rewrites prior events.
   */
  record(options: RecordEventOptions): CommittedNarrativeEvent;
  /** Events the given NPC witnessed, oldest first (retrieval ranking stays in C-492). */
  witnessedBy(npcId: string): readonly CommittedNarrativeEvent[];
  /** Serializes the record for the save envelope. */
  serialize(): NarrativeEventRecord;
  /** Restores the record from a serialized payload. */
  hydrate(data: unknown): void;
  /** Restores defaults when an older save has no `narrativeEvents` snapshot. */
  reset(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class NarrativeEventService
  extends BaseFrontendClass<NarrativeEventServiceOptions>
  implements NarrativeEventServiceInterface
{
  /** Ordered committed events, oldest first. */
  private _events = $state<CommittedNarrativeEvent[]>([]);
  /** Next monotonic per-campaign sequence to assign. */
  private _nextSequence = $state<number>(1);

  /** @inheritdoc */
  get events(): readonly CommittedNarrativeEvent[] {
    return this._events;
  }

  /** @inheritdoc */
  record(options: RecordEventOptions): CommittedNarrativeEvent {
    if (!options.campaignId || options.campaignId.length === 0) {
      throw new Error('NarrativeEventService: record requires a non-empty campaignId');
    }

    const claimantId = options.claimantId;
    const witnesses = this._dedupeWitnesses(options.actorId, options.witnesses);
    if (witnesses.length === 0) {
      throw new Error('NarrativeEventService: record requires at least one witness');
    }

    const eventBase = {
      id: crypto.randomUUID(),
      campaignId: options.campaignId,
      sequence: this._nextSequence,
      kind: options.kind,
      summary: options.summary,
      ...(options.subjectId ? { subjectId: options.subjectId } : {}),
      witnesses,
      ...(options.sourceEventId ? { sourceEventId: options.sourceEventId } : {}),
      ...(options.deltasApplied && options.deltasApplied.length > 0
        ? { deltasApplied: [...options.deltasApplied] }
        : {}),
      recordedAt: new Date().toISOString(),
    };
    let event: CommittedNarrativeEvent;
    if (options.informationKind === 'world_fact') {
      event = {
        ...eventBase,
        informationKind: options.informationKind,
        ...(claimantId ? { claimantId } : {}),
      };
    } else {
      if (!claimantId) {
        throw new Error(`NarrativeEventService: ${options.informationKind} requires a claimantId`);
      }
      event = {
        ...eventBase,
        informationKind: options.informationKind,
        claimantId,
      };
    }

    this._events = [...this._events, event];
    this._nextSequence += 1;

    this.debug('record', {
      kind: event.kind,
      informationKind: event.informationKind,
      campaignId: event.campaignId,
      witnessCount: witnesses.length,
    });

    return event;
  }

  /** @inheritdoc */
  witnessedBy(npcId: string): readonly CommittedNarrativeEvent[] {
    return this._events.filter((event) => event.witnesses.includes(npcId));
  }

  /** @inheritdoc */
  serialize(): NarrativeEventRecord {
    return { schemaVersion: 1, events: this._events, nextSequence: this._nextSequence };
  }

  /** @inheritdoc */
  hydrate(data: unknown): void {
    if (!this._isValidHydrationPayload(data)) {
      this.reset();
      return;
    }
    this._events = [...data.events];
    const minimumNextSequence =
      this._events.reduce((highest, event) => Math.max(highest, event.sequence), 0) + 1;
    this._nextSequence = Math.max(data.nextSequence ?? minimumNextSequence, minimumNextSequence);
    this.debug('hydrate', { eventCount: this._events.length });
  }

  /** @inheritdoc */
  reset(): void {
    this._events = [];
    this._nextSequence = 1;
  }

  /** Validates unknown save data before it can replace the append-only record. */
  private _isValidHydrationPayload(data: unknown): data is NarrativeEventHydrationPayload {
    if (!data || typeof data !== 'object' || !('events' in data) || !Array.isArray(data.events)) {
      return false;
    }
    if (!data.events.every((event) => Value.Check(CommittedNarrativeEventSchema, event))) {
      return false;
    }
    if ('nextSequence' in data && data.nextSequence !== undefined) {
      const { nextSequence } = data;
      if (typeof nextSequence !== 'number' || !Number.isInteger(nextSequence) || nextSequence < 1) {
        return false;
      }
    }
    return true;
  }

  /**
   * Builds the final witness set as `unique([actorId, ...witnesses].filter(Boolean))`,
   * preserving first occurrence. The acting NPC is always present even when the
   * scene cast is empty.
   */
  private _dedupeWitnesses(actorId?: string, witnesses?: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    const push = (id: string | undefined): void => {
      if (id && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    };
    push(actorId);
    for (const witness of witnesses ?? []) {
      push(witness);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const narrativeEventService: NarrativeEventServiceInterface = NarrativeEventService.create({
  className: 'NarrativeEventService',
});

// Register for save/load persistence. Older saves without a `narrativeEvents`
// snapshot fall back to `reset()` via `hydrateAllServices`, so the record loads
// empty and fills as new consequences commit (C-491 AC-4).
registerSerializable('narrativeEvents', narrativeEventService);
