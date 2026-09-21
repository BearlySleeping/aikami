// packages/frontend/storage/src/lib/operations.ts
//
// GameOperationRepository — durable operation ledger over the shared
// LocalDatabaseInterface. Owns the `game_operations` table (schema migration
// v6) that backs operation provenance and interrupted-operation recovery
// (docs/design/game_ui_hud_overhaul.md §8).
//
// Plain class (no BaseClass dependency in this package) — instantiate with
// {@link createGameOperationRepository} or `new GameOperationRepository(db)`.

import type { GameOperation, GameOperationStatus } from '@aikami/types';
import { logger } from '$logger';
import type { LocalDatabaseInterface, QueryResultRow, SqlQuery } from './storage_adapter.ts';

/** Reason recorded when boot reconciliation finds an unfinished pending row. */
export const INTERRUPTED_OPERATION_ERROR = 'Interrupted before completion';

const COLUMNS =
  'operation_id, schema_version, kind, status, campaign_id, conversation_id, turn_id, ' +
  'check_id, source_event_id, request, result, error, created_at, updated_at';

/**
 * Local ledger of durable game operations. Rows are written before an
 * operation's presentation begins and advanced from the authoritative result;
 * the repository never mutates a completed row's result.
 */
export class GameOperationRepository {
  private readonly _db: LocalDatabaseInterface;

  constructor(db: LocalDatabaseInterface) {
    this._db = db;
  }

  /** Inserts (or replaces) a full operation row. */
  async upsert(operation: GameOperation): Promise<void> {
    await this._db.execute({
      sql: `INSERT OR REPLACE INTO game_operations (${COLUMNS})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: _operationToArgs(operation),
    });
  }

  /** Returns a single operation by id, or undefined. */
  async get(operationId: string): Promise<GameOperation | undefined> {
    const result = await this._db.query({
      sql: `SELECT ${COLUMNS} FROM game_operations WHERE operation_id = ?`,
      args: [operationId],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return _rowToOperation(result.rows[0]);
  }

  /** Lists a campaign's operations, newest first, optionally by status. */
  async listByCampaign(campaignId: string, status?: GameOperationStatus): Promise<GameOperation[]> {
    if (status) {
      const result = await this._db.query({
        sql: `SELECT ${COLUMNS} FROM game_operations
              WHERE campaign_id = ? AND status = ? ORDER BY created_at DESC`,
        args: [campaignId, status],
      });
      return result.rows.map(_rowToOperation);
    }
    const result = await this._db.query({
      sql: `SELECT ${COLUMNS} FROM game_operations WHERE campaign_id = ? ORDER BY created_at DESC`,
      args: [campaignId],
    });
    return result.rows.map(_rowToOperation);
  }

  /** Lists every `pending` operation, oldest first (recovery candidates). */
  async listPending(): Promise<GameOperation[]> {
    const result = await this._db.query({
      sql: `SELECT ${COLUMNS} FROM game_operations WHERE status = 'pending' ORDER BY created_at ASC`,
      args: [],
    });
    return result.rows.map(_rowToOperation);
  }

  /**
   * Flips every stale `pending` row to `interrupted` in one transaction,
   * returning the reconciled operations. Called at boot so a restart never
   * silently rerolls a check or fabricates a completed turn.
   */
  async reconcileInterrupted(): Promise<GameOperation[]> {
    const pending = await this.listPending();
    if (pending.length === 0) {
      return [];
    }
    const now = new Date().toISOString();
    const queries: SqlQuery[] = pending.map((operation) => ({
      sql: `UPDATE game_operations
            SET status = 'interrupted', error = ?, updated_at = ?
            WHERE operation_id = ? AND status = 'pending'`,
      args: [INTERRUPTED_OPERATION_ERROR, now, operation.operationId],
    }));
    await this._db.transaction(queries);
    logger.debug('GameOperationRepository.reconcileInterrupted', { count: pending.length });
    return pending.map((operation) => ({
      ...operation,
      status: 'interrupted' as const,
      error: INTERRUPTED_OPERATION_ERROR,
      updatedAt: now,
    }));
  }

  /** Deletes an operation row (used when a caller discards a failed draft). */
  async remove(operationId: string): Promise<void> {
    await this._db.execute({
      sql: 'DELETE FROM game_operations WHERE operation_id = ?',
      args: [operationId],
    });
  }
}

/** Creates a {@link GameOperationRepository} over the given shared database. */
export const createGameOperationRepository = (
  db: LocalDatabaseInterface,
): GameOperationRepository => new GameOperationRepository(db);

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

const _operationToArgs = (operation: GameOperation): (string | number | null)[] => [
  operation.operationId,
  operation.schemaVersion,
  operation.kind,
  operation.status,
  operation.campaignId,
  operation.conversationId ?? null,
  operation.turnId ?? null,
  operation.checkId ?? null,
  operation.sourceEventId ?? null,
  operation.request,
  operation.result ?? null,
  operation.error ?? null,
  operation.createdAt,
  operation.updatedAt,
];

const _rowToOperation = (row: QueryResultRow): GameOperation => ({
  schemaVersion: row.schema_version as number,
  operationId: row.operation_id as string,
  kind: row.kind as GameOperation['kind'],
  status: row.status as GameOperation['status'],
  campaignId: row.campaign_id as string,
  conversationId: (row.conversation_id as string | null) ?? undefined,
  turnId: (row.turn_id as string | null) ?? undefined,
  checkId: (row.check_id as string | null) ?? undefined,
  sourceEventId: (row.source_event_id as string | null) ?? undefined,
  request: row.request as string,
  result: (row.result as string | null) ?? undefined,
  error: (row.error as string | null) ?? undefined,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});
