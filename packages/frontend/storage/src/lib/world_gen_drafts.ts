// packages/frontend/storage/src/lib/world_gen_drafts.ts
//
// G01 — durable store for private narrative-world drafts.
//
// These rows are DEVICE-LOCAL and deliberately unowned: no campaign id, no
// account id, no foreign key. That is the point — the game must be able to
// generate, save and reload a draft with no sign-in and no active campaign,
// which is also why the row cannot live inside the campaign or save tables.
//
// The repository is a VALIDATING projection, not a transparent one. Both
// directions cross the same three gates (structure, cross-references, UTF-8
// byte ceiling) through `parseWorldGenDraft`. The earlier version did
// `JSON.parse(blueprint) as WorldGenDraft` in both directions, which is a claim
// about the column's contents that nothing checks: a truncated write, a
// hand-edited row, or a blueprint from a newer client all reached memory as a
// well-typed draft and failed somewhere else, far from the cause.

import {
  parseWorldGenDraft,
  WORLD_GEN_DRAFT_LIMITS,
  type WorldGenDraft,
  worldGenDraftByteLength,
} from '@aikami/schemas';
import { logger } from '$logger';
import type { LocalDatabaseInterface, QueryResultRow } from './storage_adapter.ts';

const COLUMNS =
  'draft_id, schema_version, status, run_id, revision, input_json, blueprint_json, created_at, updated_at';

/**
 * Private draft repository over the shared local database.
 *
 * Plain class (no BaseClass dependency in this package) — instantiate with
 * {@link createWorldGenDraftRepository} or `new WorldGenDraftRepository(db)`.
 */
export class WorldGenDraftRepository {
  private readonly _db: LocalDatabaseInterface;

  constructor(db: LocalDatabaseInterface) {
    this._db = db;
  }

  /**
   * Inserts or replaces a draft row.
   *
   * The whole row is written in one statement so a crash cannot leave a row
   * whose status claims `complete` while its blueprint is from an older run.
   *
   * @throws {WorldGenDraftInvalidError} Before touching the database, when the
   * draft is structurally invalid, internally incoherent, or over the byte
   * ceiling. Refusing here is what keeps a malformed draft out of the column in
   * the first place.
   */
  async upsert(draft: WorldGenDraft): Promise<void> {
    const checked = parseWorldGenDraft(draft);
    if (!checked.ok) {
      throw new WorldGenDraftInvalidError(draft.draftId, checked.reason);
    }
    const serialized = JSON.stringify(draft);
    const bytes = worldGenDraftByteLength(draft);
    if (bytes > WORLD_GEN_DRAFT_LIMITS.maxBytes) {
      throw new WorldGenDraftInvalidError(
        draft.draftId,
        `Draft is ${bytes} bytes; the limit is ${WORLD_GEN_DRAFT_LIMITS.maxBytes} bytes.`,
      );
    }
    await this._db.execute({
      sql: `INSERT INTO worldgen_drafts (${COLUMNS})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(draft_id) DO UPDATE SET
              schema_version = excluded.schema_version,
              status = excluded.status,
              run_id = excluded.run_id,
              revision = excluded.revision,
              input_json = excluded.input_json,
              blueprint_json = excluded.blueprint_json,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
            WHERE excluded.revision > worldgen_drafts.revision
               OR (excluded.revision = worldgen_drafts.revision
                   AND (worldgen_drafts.status != 'accepted_preview'
                        OR excluded.status = 'accepted_preview'))`,
      args: [
        draft.draftId,
        draft.schemaVersion,
        draft.status,
        draft.runId,
        draft.revision,
        JSON.stringify(draft.input),
        serialized,
        draft.createdAt,
        draft.updatedAt,
      ],
    });
    await this._db.flush?.();
    const stored = await this.get(draft.draftId);
    if (stored === undefined || JSON.stringify(stored) !== serialized) {
      throw new WorldGenDraftInvalidError(
        draft.draftId,
        'The draft write was superseded or removed before it could be verified.',
      );
    }
    logger.debug('WorldGenDraftRepository.upsert', {
      draftId: draft.draftId,
      status: draft.status,
      revision: draft.revision,
      bytes,
    });
  }

  /** Returns a draft by id, or undefined when it does not exist. */
  async get(draftId: string): Promise<WorldGenDraft | undefined> {
    const result = await this._db.query({
      sql: `SELECT ${COLUMNS} FROM worldgen_drafts WHERE draft_id = ?`,
      args: [draftId],
    });
    const row = result.rows[0];
    return row === undefined ? undefined : _rowToDraft(row);
  }

  /** Newest-first. A row that fails validation is refused, not skipped. */
  async list(limit?: number): Promise<WorldGenDraft[]> {
    const bounded = limit === undefined ? '' : ' LIMIT ?';
    const args: (string | number)[] = limit === undefined ? [] : [limit];
    const result = await this._db.query({
      sql: `SELECT ${COLUMNS} FROM worldgen_drafts
            WHERE blueprint_json IS NOT NULL ORDER BY updated_at DESC${bounded}`,
      args,
    });
    return result.rows.map(_rowToDraft);
  }

  /**
   * The newest valid drafts, newest-first. Throws on the first unreadable row.
   *
   * The recovery path for a page reload: a service rebuilt from scratch has no
   * draft id to ask for, so hydration asks for the newest rows instead.
   *
   * Failing LOUD rather than skipping is deliberate. A row this repository
   * cannot validate is either a truncated write, a schema change, or a
   * database that has been tampered with — all of which are things the caller
   * must be told about, and none of which are fixed by silently showing the
   * next-oldest row. Skipping would also make the failure invisible in the one
   * case that matters most: a draft the user believes is saved, failing to
   * load with no message at all. G01 keeps at most one private draft per
   * device in practice, so "the newest row" and "the only row" coincide and
   * there is nothing to hide behind.
   */
  async latest(limit = 10): Promise<WorldGenDraft[]> {
    const result = await this._db.query({
      sql: `SELECT ${COLUMNS} FROM worldgen_drafts
            WHERE blueprint_json IS NOT NULL ORDER BY updated_at DESC LIMIT ?`,
      args: [limit],
    });
    return result.rows.map(_rowToDraft);
  }

  /** Removes a draft row. */
  async remove(draftId: string): Promise<void> {
    await this._db.execute({
      sql: 'DELETE FROM worldgen_drafts WHERE draft_id = ?',
      args: [draftId],
    });
  }

  /** Counts stored drafts — used by the privacy round-trip assertion. */
  async count(): Promise<number> {
    const result = await this._db.query({
      sql: 'SELECT COUNT(*) AS total FROM worldgen_drafts',
      args: [],
    });
    const row = result.rows[0] as { total?: number } | undefined;
    return Number(row?.total ?? 0);
  }
}

/** Creates a {@link WorldGenDraftRepository} over the given shared database. */
export const createWorldGenDraftRepository = (
  db: LocalDatabaseInterface,
): WorldGenDraftRepository => new WorldGenDraftRepository(db);

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/**
 * Turns a row into a validated draft.
 *
 * @throws {WorldGenDraftHasNoBlueprintError} When the row carries no payload.
 * @throws {WorldGenDraftInvalidError} When the payload is not parseable JSON,
 * fails the structural schema, fails cross-reference validation, or is over
 * the byte ceiling. Never returns a cast the gates did not approve.
 */
const _rowToDraft = (row: QueryResultRow): WorldGenDraft => {
  const blueprint = row.blueprint_json as string | null;
  if (blueprint === null) {
    // A row with no blueprint carries no draft — the caller treats it as
    // absent rather than as an exception, because "no draft yet" is an
    // ordinary state, not a fault.
    throw new WorldGenDraftHasNoBlueprintError(String(row.draft_id));
  }
  const bytes = new TextEncoder().encode(blueprint).length;
  if (bytes > WORLD_GEN_DRAFT_LIMITS.maxBytes) {
    throw new WorldGenDraftInvalidError(
      String(row.draft_id),
      `Stored blueprint is ${bytes} bytes; the limit is ${WORLD_GEN_DRAFT_LIMITS.maxBytes} bytes.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(blueprint);
  } catch (error) {
    throw new WorldGenDraftInvalidError(
      String(row.draft_id),
      `Stored blueprint is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}.`,
    );
  }
  const checked = parseWorldGenDraft(parsed);
  if (!checked.ok) {
    throw new WorldGenDraftInvalidError(String(row.draft_id), checked.reason);
  }
  if (!_metadataMatches(row, checked.draft)) {
    throw new WorldGenDraftInvalidError(
      String(row.draft_id),
      'Stored row metadata disagrees with its blueprint.',
    );
  }
  return checked.draft;
};

/** Metadata participates in ordering and guarded writes, so it must match too. */
const _metadataMatches = (row: QueryResultRow, draft: WorldGenDraft): boolean => {
  const revision = Number(row.revision);
  return (
    Number.isSafeInteger(revision) &&
    revision === draft.revision &&
    Number(row.schema_version) === draft.schemaVersion &&
    row.draft_id === draft.draftId &&
    row.run_id === draft.runId &&
    row.status === draft.status &&
    row.created_at === draft.createdAt &&
    row.updated_at === draft.updatedAt
  );
};

/** Raised when a draft row exists but carries no serialized blueprint. */
export class WorldGenDraftHasNoBlueprintError extends Error {
  readonly draftId: string;

  constructor(draftId: string) {
    super(`Stored draft ${draftId} has no blueprint payload.`);
    this.name = 'WorldGenDraftHasNoBlueprintError';
    this.draftId = draftId;
  }
}

/** Raised when a draft is refused by structure, coherence or size. */
export class WorldGenDraftInvalidError extends Error {
  readonly draftId: string;

  constructor(draftId: string, reason: string) {
    super(`Draft ${draftId} is not storable: ${reason}`);
    this.name = 'WorldGenDraftInvalidError';
    this.draftId = draftId;
  }
}
