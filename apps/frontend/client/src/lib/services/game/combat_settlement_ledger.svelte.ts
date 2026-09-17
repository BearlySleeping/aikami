// apps/frontend/client/src/lib/services/game/combat_settlement_ledger.svelte.ts
//
// Durable settlement identity for combat consequences (review F7/F9).
//
// External consequences — quest progression, defeated-enemy flags, rewards, the
// delayed return to exploration — must be applied EXACTLY ONCE from the game's
// point of view, across:
//
//   * duplicate terminal delivery (the engine may re-publish the terminal event);
//   * save/reload (the ledger is persisted with the other domain services);
//   * crash/restart;
//   * a delayed close callback from an OLD run firing into a NEW encounter.
//
// The identity is the kernel's `settlementId`, which already binds the authored
// encounter, the EXECUTION RUN, the committed revision and the settlement reason
// (`settlementIdFor`). That is deliberately not "the encounter id" (it recurs on
// retry) and not "the state revision" (it recurs across runs).
//
// Two separate guarantees live here:
//
//   1. `appliedSettlementIds` — the durable, persisted ledger. A settlement in it
//      never has its consequences applied again.
//   2. `activeIdentity` — the in-memory run guard for DELAYED callbacks. A close
//      callback scheduled for one settlement becomes inert once a different
//      encounter is active, so it cannot close a replacement encounter's overlay.
//
// Contract: C-532 AC-5, C-334

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { registerSerializable, type SerializableService } from './serializable_service';

/** Bounded retention: a long campaign must not grow the save without limit. */
const MAX_APPLIED_SETTLEMENTS = 512;

type CombatSettlementLedgerInterface = BaseFrontendClassInterface & {
  /**
   * Claims a settlement for consequence application.
   *
   * @returns `true` when the caller won the claim (and must apply the
   *   consequences exactly once); `false` when it was already applied.
   */
  claim(settlementId: string): boolean;
  /** The identity of the encounter currently being presented, if any. */
  activeIdentity(): string | null;
  /** Records the identity of a newly started encounter (in-memory only). */
  begin(identity: string | null): void;
  /**
   * Whether a DELAYED callback scheduled for `identity` may still act.
   *
   * `false` once a different encounter became active, which is what stops a
   * finished encounter's close callback from closing its replacement.
   */
  isActive(identity: string | null): boolean;
  /** Clears the in-memory run guard (the encounter's presentation is over). */
  end(): void;
  /** Forgets every applied settlement (test isolation / new campaign). */
  reset(): void;
};

class CombatSettlementLedger
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements
    CombatSettlementLedgerInterface,
    SerializableService<{ appliedSettlementIds: string[] }>
{
  /** Durable: persisted with the other domain services (C-331/C-334). */
  appliedSettlementIds: string[] = $state<string[]>([]);

  /** In-memory only: never persisted, meaningless across a reload. */
  private _activeIdentity: string | null = null;

  /** Whether this settlement's consequences have already been applied. */
  private _hasApplied(settlementId: string): boolean {
    return this.appliedSettlementIds.includes(settlementId);
  }

  claim(settlementId: string): boolean {
    if (this._hasApplied(settlementId)) {
      return false;
    }
    // Bounded, oldest-first eviction: the newest settlements are the ones a
    // duplicate delivery or a reload can plausibly re-present.
    const next = [...this.appliedSettlementIds, settlementId];
    this.appliedSettlementIds =
      next.length > MAX_APPLIED_SETTLEMENTS ? next.slice(-MAX_APPLIED_SETTLEMENTS) : next;
    return true;
  }

  activeIdentity(): string | null {
    return this._activeIdentity;
  }

  begin(identity: string | null): void {
    this._activeIdentity = identity;
  }

  isActive(identity: string | null): boolean {
    return identity !== null && this._activeIdentity === identity;
  }

  end(): void {
    this._activeIdentity = null;
  }

  reset(): void {
    this.appliedSettlementIds = [];
    this._activeIdentity = null;
  }

  /** @inheritdoc */
  serialize(): { appliedSettlementIds: string[] } {
    return { appliedSettlementIds: [...this.appliedSettlementIds] };
  }

  /** @inheritdoc */
  hydrate(data: unknown): void {
    if (data === null || typeof data !== 'object') {
      return;
    }
    const record = data as { appliedSettlementIds?: unknown };
    if (!Array.isArray(record.appliedSettlementIds)) {
      return;
    }
    this.appliedSettlementIds = record.appliedSettlementIds.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
  }
}

/** Shared ledger instance for the running game. */
export const combatSettlementLedger: CombatSettlementLedgerInterface =
  CombatSettlementLedger.create({
    className: 'CombatSettlementLedger',
  });

// Durable across save/load: the exactly-once guarantee must survive a reload.
registerSerializable(
  'combatSettlement',
  combatSettlementLedger as unknown as SerializableService<unknown>, // guard-ignore lint/type-safety/casting: registerSerializable call - service typed as SerializableService at runtime
);
