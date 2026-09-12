// apps/frontend/client/src/lib/services/game/operation_ledger_service.svelte.ts
//
// Operation ledger — durable provenance and interrupted-operation recovery for
// AI-driven work (dialogue turns, checks, image/TTS generation). See
// docs/design/game_ui_hud_overhaul.md §8 and verification #9.
//
// Callers `begin` an operation before its presentation starts, then `complete`
// it with the authoritative result or `fail` it with a reason. On boot,
// `reconcileInterrupted` flips anything still `pending` to `interrupted` so a
// restart restores the true status instead of rerolling or fabricating a
// result. The ledger is audit/recovery metadata only — never a source of rules
// authority.
//
// Contract: docs/design/game_ui_hud_overhaul.md — operation provenance

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import {
  createGameOperationRepository,
  type GameOperationRepository,
  getLocalDatabase,
} from '@aikami/frontend/storage';
import { GAME_OPERATION_SCHEMA_VERSION } from '@aikami/schemas';
import type { BeginGameOperationOptions, GameOperation } from '@aikami/types';

export type OperationLedgerServiceOptions = BaseFrontendClassOptions & {
  /**
   * Pre-built repository override — tests inject one over an in-memory
   * database. Production omits this and the service lazily opens the shared
   * local database on first use.
   */
  repository?: GameOperationRepository;
};

export type OperationLedgerServiceInterface = BaseFrontendClassInterface & {
  /** Interrupted operations surfaced for recovery UI, newest first. */
  readonly interruptedOperations: readonly GameOperation[];
  /** Records a new `pending` operation before presentation begins. */
  begin(options: BeginGameOperationOptions): Promise<GameOperation>;
  /** Advances an operation to `completed` with its authoritative result. */
  complete(operationId: string, result?: unknown): Promise<void>;
  /**
   * Resumes an `interrupted` operation to `completed` with the recorded
   * result. Unlike {@link complete}, this is the explicit player-initiated
   * recovery path and only accepts `interrupted` rows.
   */
  resume(operationId: string, result?: unknown): Promise<void>;
  /** Advances an operation to `failed` with a reason. */
  fail(operationId: string, error: string): Promise<void>;
  /** Reads one operation, for resume/recovery prompts. */
  get(operationId: string): Promise<GameOperation | undefined>;
  /** Lists `pending` operations, optionally scoped to a campaign. */
  listPending(campaignId?: string): Promise<GameOperation[]>;
  /**
   * Reconciles stale `pending` rows to `interrupted` and returns them. Safe to
   * call on every boot; idempotent once nothing is pending.
   */
  reconcileInterrupted(): Promise<readonly GameOperation[]>;
  /** Dismisses a recovered operation from the interrupted list. */
  dismissInterrupted(operationId: string): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class OperationLedgerService
  extends BaseFrontendClass<OperationLedgerServiceOptions>
  implements OperationLedgerServiceInterface
{
  private _repository: GameOperationRepository | undefined;

  interruptedOperations = $state<GameOperation[]>([]);

  constructor(options: OperationLedgerServiceOptions) {
    super(options);
    this._repository = options.repository;
  }

  /** Lazily opens the shared local database on first use. */
  private async _repo(): Promise<GameOperationRepository> {
    if (!this._repository) {
      this._repository = createGameOperationRepository(await getLocalDatabase());
    }
    return this._repository;
  }

  /** @inheritdoc */
  async begin(options: BeginGameOperationOptions): Promise<GameOperation> {
    const now = new Date().toISOString();
    const operation: GameOperation = {
      schemaVersion: GAME_OPERATION_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      kind: options.kind,
      status: 'pending',
      campaignId: options.campaignId,
      conversationId: options.conversationId,
      turnId: options.turnId,
      checkId: options.checkId,
      sourceEventId: options.sourceEventId,
      request: JSON.stringify(options.request ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    await (await this._repo()).upsert(operation);
    return operation;
  }

  /** @inheritdoc */
  async complete(operationId: string, result?: unknown): Promise<void> {
    await this._settle(
      operationId,
      'completed',
      result === undefined ? undefined : JSON.stringify(result),
    );
  }

  /** @inheritdoc */
  async resume(operationId: string, result?: unknown): Promise<void> {
    const repository = await this._repo();
    const existing = await repository.get(operationId);
    if (existing?.status !== 'interrupted') {
      return;
    }
    await repository.upsert({
      ...existing,
      status: 'completed',
      result: result === undefined ? undefined : JSON.stringify(result),
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
  }

  /** @inheritdoc */
  async fail(operationId: string, error: string): Promise<void> {
    await this._settle(operationId, 'failed', undefined, error);
  }

  /** @inheritdoc */
  async get(operationId: string): Promise<GameOperation | undefined> {
    return (await this._repo()).get(operationId);
  }

  /** @inheritdoc */
  async listPending(campaignId?: string): Promise<GameOperation[]> {
    const pending = await (await this._repo()).listPending();
    return campaignId
      ? pending.filter((operation) => operation.campaignId === campaignId)
      : pending;
  }

  /** @inheritdoc */
  async reconcileInterrupted(): Promise<readonly GameOperation[]> {
    const reconciled = await (await this._repo()).reconcileInterrupted();
    if (reconciled.length > 0) {
      this.interruptedOperations = reconciled;
      this.warn('reconcileInterrupted', { count: reconciled.length });
    }
    return reconciled;
  }

  /** @inheritdoc */
  dismissInterrupted(operationId: string): void {
    this.interruptedOperations = this.interruptedOperations.filter(
      (operation) => operation.operationId !== operationId,
    );
  }

  /**
   * Advances a non-terminal operation to a terminal status. A missing or
   * already-terminal row is left untouched so a late completion cannot
   * overwrite a recovered interruption.
   */
  private async _settle(
    operationId: string,
    status: 'completed' | 'failed',
    result?: string,
    error?: string,
  ): Promise<void> {
    const repository = await this._repo();
    const existing = await repository.get(operationId);
    if (existing?.status !== 'pending') {
      return;
    }
    await repository.upsert({
      ...existing,
      status,
      result,
      error,
      updatedAt: new Date().toISOString(),
    });
  }
}

/** Shared singleton instance. */
export const operationLedgerService: OperationLedgerServiceInterface =
  OperationLedgerService.create({ className: 'OperationLedgerService' });
