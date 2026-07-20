// apps/frontend/client/src/lib/services/game/party_roster_service.svelte.ts
//
// Party roster service — manages companion recruitment, dismissal,
// approval tracking, and roster state. Singleton with $state for
// reactive UI binding. Persisted via save/load envelope.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-1, AC-5)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { FormationType, PartyRosterEntry, PartyState } from '@aikami/types';
import { registerSerializable } from './serializable_service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartyRosterServiceOptions = BaseFrontendClassOptions;

export type PartyRosterServiceInterface = BaseFrontendClassInterface & {
  /** All current party members (reactive). */
  readonly members: readonly PartyRosterEntry[];
  /** Number of active companions. */
  readonly activeCount: number;
  /** Maximum party size. */
  readonly maxSize: number;
  /** Current formation type. */
  formation: FormationType;
  /** Whether the party is full. */
  readonly isFull: boolean;

  /**
   * Recruits an NPC as a companion.
   * Idempotent — returns existing entry if already recruited.
   */
  recruit(options: {
    npcId: string;
    name: string;
    classId: string;
    level?: number;
    initialApproval?: number;
  }): PartyRosterEntry | undefined;

  /** Dismisses a companion from the party. Idempotent. */
  dismiss(npcId: string): boolean;

  /** Checks if an NPC is in the party. */
  hasMember(npcId: string): boolean;

  /** Gets a member by NPC ID. */
  getMember(npcId: string): PartyRosterEntry | undefined;

  /** Adjusts the approval score for a companion (clamped to [-100, 100]). */
  adjustApproval(options: { npcId: string; delta: number }): void;

  /** Gets the approval score for a companion. */
  getApproval(npcId: string): number;

  /** Activates a companion's personal quest. */
  activatePersonalQuest(npcId: string): void;

  /** Deactivates a companion's personal quest. */
  deactivatePersonalQuest(npcId: string): void;

  /** Checks if party is empty. */
  isEmpty(): boolean;

  /** Serializes party state for save/load. */
  serialize(): PartyState;

  /** Hydrates party state from save data. */
  hydrate(state: PartyState): void;

  /** Resets the party roster to empty. */
  reset(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PartyRosterService
  extends BaseFrontendClass<PartyRosterServiceOptions>
  implements PartyRosterServiceInterface
{
  members = $state<PartyRosterEntry[]>([]);
  maxSize = $state<number>(4);
  formation = $state<FormationType>('line');

  get activeCount(): number {
    return this.members.length;
  }

  get isFull(): boolean {
    return this.members.length >= this.maxSize;
  }

  /** @inheritdoc */
  recruit(options: {
    npcId: string;
    name: string;
    classId: string;
    level?: number;
    initialApproval?: number;
  }): PartyRosterEntry | undefined {
    const { npcId, name, classId, level = 1, initialApproval = 0 } = options;

    // Idempotency check
    const existing = this.members.find((m) => m.npcId === npcId);
    if (existing) {
      this.debug('recruit:already-recruited', { npcId, name });
      return existing;
    }

    // Capacity check
    if (this.isFull) {
      this.warn('recruit:party-full', { npcId, name, maxSize: this.maxSize });
      return undefined;
    }

    const entry: PartyRosterEntry = {
      npcId,
      name,
      classId,
      level,
      approval: initialApproval,
      recruitedAt: new Date().toISOString(),
      personalQuestActive: false,
      equipmentSlotIds: [],
    };

    this.members = [...this.members, entry];
    this.debug('recruit', { npcId, name, classId, level, approval: initialApproval });

    return entry;
  }

  /** @inheritdoc */
  dismiss(npcId: string): boolean {
    const index = this.members.findIndex((m) => m.npcId === npcId);
    if (index === -1) {
      this.debug('dismiss:not-found', { npcId });
      return false;
    }

    const removed = this.members[index];
    this.members = this.members.filter((m) => m.npcId !== npcId);
    this.debug('dismiss', { npcId, name: removed.name });
    return true;
  }

  /** @inheritdoc */
  hasMember(npcId: string): boolean {
    return this.members.some((m) => m.npcId === npcId);
  }

  /** @inheritdoc */
  getMember(npcId: string): PartyRosterEntry | undefined {
    return this.members.find((m) => m.npcId === npcId);
  }

  /** @inheritdoc */
  adjustApproval(options: { npcId: string; delta: number }): void {
    const { npcId, delta } = options;
    const index = this.members.findIndex((m) => m.npcId === npcId);
    if (index === -1) {
      return;
    }

    const member = this.members[index];
    const newApproval = Math.max(-100, Math.min(100, member.approval + delta));
    const clamped = member.approval + delta !== newApproval;

    const updated = [...this.members];
    updated[index] = { ...member, approval: newApproval };
    this.members = updated;

    if (clamped) {
      this.debug('adjustApproval:clamped', { npcId, delta, newApproval });
    }
  }

  /** @inheritdoc */
  getApproval(npcId: string): number {
    return this.members.find((m) => m.npcId === npcId)?.approval ?? 0;
  }

  /** @inheritdoc */
  activatePersonalQuest(npcId: string): void {
    const index = this.members.findIndex((m) => m.npcId === npcId);
    if (index === -1) {
      return;
    }

    const updated = [...this.members];
    updated[index] = { ...updated[index], personalQuestActive: true };
    this.members = updated;
    this.debug('activatePersonalQuest', { npcId });
  }

  /** @inheritdoc */
  deactivatePersonalQuest(npcId: string): void {
    const index = this.members.findIndex((m) => m.npcId === npcId);
    if (index === -1) {
      return;
    }

    const updated = [...this.members];
    updated[index] = { ...updated[index], personalQuestActive: false };
    this.members = updated;
    this.debug('deactivatePersonalQuest', { npcId });
  }

  /** @inheritdoc */
  isEmpty(): boolean {
    return this.members.length === 0;
  }

  /** @inheritdoc */
  serialize(): PartyState {
    return {
      members: this.members.map((m) => ({ ...m })),
      maxSize: this.maxSize,
      formation: this.formation,
    };
  }

  /** @inheritdoc */
  hydrate(state: PartyState): void {
    this.members = state.members.map((m) => ({ ...m }));
    this.maxSize = state.maxSize ?? 4;
    this.formation = state.formation ?? 'line';
    this.debug('hydrate', { memberCount: this.members.length });
  }

  /** @inheritdoc */
  reset(): void {
    this.members = [];
    this.maxSize = 4;
    this.formation = 'line';
    this.debug('reset');
  }
}

export const partyRosterService: PartyRosterServiceInterface = PartyRosterService.create({
  className: 'PartyRosterService',
});

// Register for save/load persistence (C-340 AC-5)
registerSerializable(
  'party',
  partyRosterService as unknown as { serialize(): unknown; hydrate(data: unknown): void },
);
