// packages/frontend/storage/src/lib/generation_records.ts
//
// C-518: the durable generation record store — private lineage, candidate
// status and acceptance, on the local (device) plane.
//
// Three invariants this module exists to hold:
//
//   1. **A resolvable tag always has its lineage.** The candidate row, its
//      artifact rows and (when accepted) its acceptance row are written in one
//      transaction, so a crash cannot leave an accepted-looking row behind.
//   2. **Acceptance binds exact bytes.** The acceptance stores the prepared
//      hash *and* the transformation-chain hash it was granted under; changing
//      either invalidates it without deleting the accepted content.
//   3. **Cleanup is reference-aware.** A deduplicated blob shared by another
//      tag/candidate is never reported as orphaned.
//
// Storage persists and compares hashes; it never computes them — chain hashes
// are derived by `@aikami/local-ai` and passed in.
//
// Contract: C-518 Generation provenance and candidate records

import type {
  AcceptanceRecord,
  CandidateRecord,
  CandidateStatus,
  GenerationProvenance,
  GenerationProvenanceState,
} from '@aikami/types';
import { logger } from '$logger';
import {
  type GeneratedAssetRegistration,
  type GeneratedAssetRegistrationResult,
  registerGeneratedAssetRowWithAssociatedWrites,
} from './assets_generated.ts';
import type { LocalDatabaseInterface, SqlQuery } from './storage_adapter.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What an artifact hash means to a candidate. */
export type GenerationArtifactRole = 'raw' | 'prepared' | 'reference' | 'validation_report';

/** One artifact hash a candidate owns. */
export type GenerationArtifactRef = {
  hash: string;
  role: GenerationArtifactRole;
};

/** Input for {@link writeGenerationCandidate}. */
export type GenerationCandidateWrite = {
  candidateId: string;
  tag: string;
  /** Opaque C-519 job link, when one exists. */
  jobId?: string;
  status: CandidateStatus;
  preparedHash: string;
  /** `unknown` for a legacy row — never a fabricated `captured`. */
  provenanceState: GenerationProvenanceState;
  /** The full private record. Absent for a legacy row. */
  record?: GenerationProvenance;
  /** Every hash this candidate owns (raw/prepared/references/report). */
  artifacts?: readonly GenerationArtifactRef[];
  /** The candidate this one supersedes, when it is an explicit revision. */
  revisionOf?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

/** Outcome of {@link writeGenerationCandidate}. */
export type GenerationCandidateWriteResult = {
  created: boolean;
  /** True when the stored prepared hash changed (a new candidate by identity). */
  changedBytes: boolean;
};

/** Input for the sole write path that grants accepted status. */
export type GenerationAcceptanceWrite = {
  acceptanceId: string;
  candidateId: string;
  preparedHash: string;
  validationReportHash: string;
  transformationHash: string;
  acceptedAt: string;
  /** `revisionOf` from the candidate row, or an explicit supersede target. */
  revisionOf?: string;
};

/** Thrown when accepting would silently abandon an accepted candidate. */
export class GenerationRevisionConflictError extends Error {
  /** The tag both candidates claim. */
  readonly tag: string;
  /** The candidate already accepted for the tag. */
  readonly acceptedCandidateId: string;

  constructor(options: { tag: string; acceptedCandidateId: string; candidateId: string }) {
    super(
      `Accepting "${options.candidateId}" for "${options.tag}" would abandon the already-accepted candidate "${options.acceptedCandidateId}" — pass an explicit revision decision (revisionOf) to supersede it.`,
    );
    this.name = 'GenerationRevisionConflictError';
    this.tag = options.tag;
    this.acceptedCandidateId = options.acceptedCandidateId;
  }
}

/** Outcome of {@link deleteGenerationCandidate}. */
export type DeleteGenerationCandidateResult = {
  deleted: boolean;
  /** Why nothing was deleted (`not_found`). */
  reason?: string;
  /**
   * Hashes this candidate was the *only* referent of. Cache bytes may be
   * removed for these and only these — a shared blob is never orphaned.
   */
  orphanedHashes: readonly string[];
};

/** One hash and the candidates/tags still referencing it. */
export type GenerationArtifactReference = {
  hash: string;
  candidateIds: readonly string[];
  tags: readonly string[];
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Upserts a candidate row without granting accepted status. */
const _upsertCandidate = (write: GenerationCandidateWrite): { sql: string; args: unknown[] } => ({
  sql: `INSERT INTO generation_candidates (
          candidate_id, tag, job_id, status, prepared_hash, provenance_state,
          record_json, revision_of, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(candidate_id) DO UPDATE SET
          tag = excluded.tag,
          job_id = excluded.job_id,
          status = CASE
            WHEN generation_candidates.status = 'accepted' THEN generation_candidates.status
            ELSE excluded.status
          END,
          prepared_hash = excluded.prepared_hash,
          provenance_state = excluded.provenance_state,
          record_json = excluded.record_json,
          revision_of = excluded.revision_of,
          note = excluded.note,
          updated_at = excluded.updated_at`,
  args: [
    write.candidateId,
    write.tag,
    write.jobId ?? null,
    write.status,
    write.preparedHash,
    write.provenanceState,
    write.record === undefined ? null : JSON.stringify(write.record),
    write.revisionOf ?? null,
    write.note ?? null,
    write.createdAt,
    write.updatedAt,
  ],
});

/** Builds candidate, lineage JSON and artifact writes for one enclosing transaction. */
const _candidateQueries = (write: GenerationCandidateWrite): SqlQuery[] => {
  const queries: SqlQuery[] = [_upsertCandidate(write)];

  if (write.artifacts !== undefined && write.artifacts.length > 0) {
    queries.push({
      sql: 'DELETE FROM generation_artifacts WHERE candidate_id = ?',
      args: [write.candidateId],
    });
    for (const artifact of write.artifacts) {
      queries.push({
        sql: `INSERT OR REPLACE INTO generation_artifacts (hash, candidate_id, role)
              VALUES (?, ?, ?)`,
        args: [artifact.hash, write.candidateId, artifact.role],
      });
    }
  }

  return queries;
};

/** Accepted status is reserved for the transaction that also writes acceptance evidence. */
const _assertCandidateIsNotAccepted = (write: GenerationCandidateWrite): void => {
  if (write.status === 'accepted') {
    throw new Error(
      `Cannot write candidate "${write.candidateId}" with accepted status — use recordAcceptance`,
    );
  }
};

/**
 * Writes a candidate and its artifact index atomically.
 *
 * Idempotent on `candidateId`: re-running the same write (a retry) converges
 * on the same rows rather than duplicating them.
 */
export const writeGenerationCandidate = async (
  db: LocalDatabaseInterface,
  write: GenerationCandidateWrite,
): Promise<GenerationCandidateWriteResult> => {
  _assertCandidateIsNotAccepted(write);
  const existing = await db.query({
    sql: 'SELECT prepared_hash, status FROM generation_candidates WHERE candidate_id = ?',
    args: [write.candidateId],
  });
  const prior = existing.rows[0];
  const changedBytes =
    prior !== undefined && (prior.prepared_hash as string) !== write.preparedHash;

  await db.transaction(_candidateQueries(write));
  await db.flush?.();

  logger.debug('GenerationRecordStore.writeCandidate', {
    candidateId: write.candidateId,
    tag: write.tag,
    status: write.status,
    preparedHash: write.preparedHash,
    created: prior === undefined,
    changedBytes,
  });

  return { created: prior === undefined, changedBytes };
};

/** Prepares acceptance, supersede and validation-artifact writes. */
const _prepareAcceptanceQueries = async (options: {
  db: LocalDatabaseInterface;
  acceptance: GenerationAcceptanceWrite;
  tag?: string;
}): Promise<{ queries: SqlQuery[]; superseded: string | undefined; tag: string }> => {
  const { db, acceptance } = options;
  let tag = options.tag;
  if (tag === undefined) {
    const candidate = await db.query({
      sql: 'SELECT tag FROM generation_candidates WHERE candidate_id = ?',
      args: [acceptance.candidateId],
    });
    tag = candidate.rows[0]?.tag as string | undefined;
  }
  if (tag === undefined) {
    throw new Error(
      `Cannot accept "${acceptance.candidateId}" — no candidate row with that id exists`,
    );
  }

  const alreadyAccepted = await db.query({
    sql: `SELECT a.candidate_id AS candidate_id
          FROM generation_acceptances a
          JOIN generation_candidates c ON c.candidate_id = a.candidate_id
          WHERE c.tag = ? AND a.candidate_id != ?`,
    args: [tag, acceptance.candidateId],
  });
  const superseded = alreadyAccepted.rows[0]?.candidate_id as string | undefined;
  if (superseded !== undefined && superseded !== acceptance.revisionOf) {
    throw new GenerationRevisionConflictError({
      tag,
      acceptedCandidateId: superseded,
      candidateId: acceptance.candidateId,
    });
  }

  const queries: SqlQuery[] = [];
  if (superseded !== undefined) {
    queries.push({
      sql: `UPDATE generation_candidates SET status = 'superseded', updated_at = ?
            WHERE candidate_id = ?`,
      args: [acceptance.acceptedAt, superseded],
    });
    queries.push({
      sql: 'DELETE FROM generation_acceptances WHERE candidate_id = ?',
      args: [superseded],
    });
  }

  queries.push({
    sql: `INSERT OR REPLACE INTO generation_acceptances (
            acceptance_id, candidate_id, prepared_hash, validation_report_hash,
            transformation_hash, accepted_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      acceptance.acceptanceId,
      acceptance.candidateId,
      acceptance.preparedHash,
      acceptance.validationReportHash,
      acceptance.transformationHash,
      acceptance.acceptedAt,
    ],
  });
  queries.push({
    sql: `UPDATE generation_candidates SET status = 'accepted', updated_at = ?
          WHERE candidate_id = ?`,
    args: [acceptance.acceptedAt, acceptance.candidateId],
  });
  queries.push({
    sql: `INSERT OR REPLACE INTO generation_artifacts (hash, candidate_id, role)
          VALUES (?, ?, 'validation_report')`,
    args: [acceptance.validationReportHash, acceptance.candidateId],
  });

  return { queries, superseded, tag };
};

/**
 * Records an acceptance for an accepted candidate.
 *
 * Two-candidate safety: accepting a second candidate for one logical asset
 * requires an explicit revision decision. Without one the write refuses rather
 * than silently abandoning the content the previous acceptance authorised.
 *
 * @throws {@link GenerationRevisionConflictError} when another candidate for
 *         the same tag is already accepted and no explicit revision is given.
 */
export const recordAcceptance = async (
  db: LocalDatabaseInterface,
  acceptance: GenerationAcceptanceWrite,
): Promise<void> => {
  const prepared = await _prepareAcceptanceQueries({ db, acceptance });
  await db.transaction(prepared.queries);
  await db.flush?.();

  logger.debug('GenerationRecordStore.recordAcceptance', {
    acceptanceId: acceptance.acceptanceId,
    candidateId: acceptance.candidateId,
    tag: prepared.tag,
    superseded: prepared.superseded,
  });
};

/**
 * Commits a generated registry row with its candidate lineage and acceptance.
 *
 * Cache bytes are intentionally outside this function; callers write them
 * first, then use this single SQLite transaction for every referencing row.
 */
export const registerGeneratedAssetRecord = async (
  db: LocalDatabaseInterface,
  options: {
    asset: GeneratedAssetRegistration;
    candidate: GenerationCandidateWrite;
    acceptance?: GenerationAcceptanceWrite;
  },
): Promise<{
  registration: GeneratedAssetRegistrationResult;
  candidate: GenerationCandidateWriteResult;
}> => {
  const { asset, candidate, acceptance } = options;
  _assertCandidateIsNotAccepted(candidate);
  if (candidate.tag !== asset.tag || candidate.preparedHash !== asset.hash) {
    throw new Error('Generated candidate identity must match the registry tag and prepared hash');
  }
  if (
    candidate.record !== undefined &&
    (candidate.record.candidateId !== candidate.candidateId ||
      candidate.record.tag !== candidate.tag ||
      candidate.record.preparedHash !== candidate.preparedHash)
  ) {
    throw new Error('Generation provenance identity must match its candidate row');
  }
  if (
    acceptance !== undefined &&
    (acceptance.candidateId !== candidate.candidateId ||
      acceptance.preparedHash !== candidate.preparedHash)
  ) {
    throw new Error('Generation acceptance identity must match its candidate row');
  }

  let candidateResult: GenerationCandidateWriteResult | undefined;
  let acceptedSuperseded: string | undefined;
  const registration = await registerGeneratedAssetRowWithAssociatedWrites({
    db,
    asset,
    prepareAssociatedQueries: async () => {
      const existing = await db.query({
        sql: 'SELECT prepared_hash FROM generation_candidates WHERE candidate_id = ?',
        args: [candidate.candidateId],
      });
      const prior = existing.rows[0];
      candidateResult = {
        created: prior === undefined,
        changedBytes:
          prior !== undefined && (prior.prepared_hash as string) !== candidate.preparedHash,
      };

      if (acceptance !== undefined) {
        const prepared = await _prepareAcceptanceQueries({ db, acceptance, tag: candidate.tag });
        acceptedSuperseded = prepared.superseded;
        return [..._candidateQueries(candidate), ...prepared.queries];
      }
      return _candidateQueries(candidate);
    },
  });

  if (candidateResult === undefined) {
    throw new Error('Generated candidate transaction was not prepared');
  }
  logger.debug('GenerationRecordStore.registerGeneratedAssetRecord', {
    candidateId: candidate.candidateId,
    tag: candidate.tag,
    accepted: acceptance !== undefined,
    superseded: acceptedSuperseded,
  });
  return { registration, candidate: candidateResult };
};

/** Sets a candidate's review status (reject / supersede / back to review). */
export const setCandidateStatus = async (
  db: LocalDatabaseInterface,
  options: {
    candidateId: string;
    status: Exclude<CandidateStatus, 'accepted'>;
    updatedAt: string;
    note?: string;
  },
): Promise<void> => {
  await db.transaction([
    {
      sql: `UPDATE generation_candidates SET status = ?, note = COALESCE(?, note), updated_at = ?
            WHERE candidate_id = ?`,
      args: [options.status, options.note ?? null, options.updatedAt, options.candidateId],
    },
    ...(options.status === 'rejected' || options.status === 'superseded'
      ? [
          {
            sql: 'DELETE FROM generation_acceptances WHERE candidate_id = ?',
            args: [options.candidateId],
          },
        ]
      : []),
  ]);
  await db.flush?.();
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const _candidateFromRow = (row: Record<string, unknown>): CandidateRecord => ({
  candidateId: row.candidate_id as string,
  tag: row.tag as string,
  ...(row.job_id === null ? {} : { jobId: row.job_id as string }),
  status: row.status as CandidateStatus,
  preparedHash: row.prepared_hash as string,
  provenanceState: row.provenance_state as GenerationProvenanceState,
  ...(row.revision_of === null ? {} : { revisionOf: row.revision_of as string }),
  ...(row.note === null ? {} : { note: row.note as string }),
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

/** Reads one candidate row, or undefined. */
export const readCandidateRecord = async (
  db: LocalDatabaseInterface,
  candidateId: string,
): Promise<CandidateRecord | undefined> => {
  const result = await db.query({
    sql: 'SELECT * FROM generation_candidates WHERE candidate_id = ?',
    args: [candidateId],
  });
  const row = result.rows[0];
  return row === undefined ? undefined : _candidateFromRow(row);
};

/** Lists every candidate recorded for a tag, newest first. */
export const listCandidatesForTag = async (
  db: LocalDatabaseInterface,
  tag: string,
): Promise<CandidateRecord[]> => {
  const result = await db.query({
    sql: 'SELECT * FROM generation_candidates WHERE tag = ? ORDER BY updated_at DESC, candidate_id ASC',
    args: [tag],
  });
  return result.rows.map(_candidateFromRow);
};

/** Reads the private lineage record for a candidate, or undefined. */
export const readGenerationProvenance = async (
  db: LocalDatabaseInterface,
  candidateId: string,
): Promise<GenerationProvenance | undefined> => {
  const result = await db.query({
    sql: 'SELECT record_json FROM generation_candidates WHERE candidate_id = ?',
    args: [candidateId],
  });
  const raw = result.rows[0]?.record_json;
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }
  return JSON.parse(raw) as GenerationProvenance;
};

/** Reads the acceptance recorded for a candidate, or undefined. */
export const readAcceptance = async (
  db: LocalDatabaseInterface,
  candidateId: string,
): Promise<AcceptanceRecord | undefined> => {
  const result = await db.query({
    sql: 'SELECT * FROM generation_acceptances WHERE candidate_id = ?',
    args: [candidateId],
  });
  const row = result.rows[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    acceptanceId: row.acceptance_id as string,
    candidateId: row.candidate_id as string,
    preparedHash: row.prepared_hash as string,
    validationReportHash: row.validation_report_hash as string,
    transformationHash: row.transformation_hash as string,
    acceptedAt: row.accepted_at as string,
  };
};

/**
 * Whether an acceptance still authorises the candidate it was granted for.
 *
 * Both the prepared bytes and the transformation chain must be unchanged —
 * replacing either invalidates the acceptance. The accepted content itself is
 * never deleted by this check; it simply stops being authorised.
 */
export const isAcceptanceCurrent = async (
  db: LocalDatabaseInterface,
  options: {
    candidateId: string;
    /** The prepared hash being used now. */
    preparedHash: string;
    /** The chain hash of the provenance currently recorded. */
    transformationHash: string;
  },
): Promise<boolean> => {
  const acceptance = await readAcceptance(db, options.candidateId);
  if (acceptance === undefined) {
    return false;
  }
  return (
    acceptance.preparedHash === options.preparedHash &&
    acceptance.transformationHash === options.transformationHash
  );
};

// ---------------------------------------------------------------------------
// Reference-aware cleanup
// ---------------------------------------------------------------------------

/**
 * Reports which candidates/tags still reference each hash.
 *
 * The guard that makes deduplicated bytes safe: a blob is only removable when
 * this returns no references for it.
 */
export const findArtifactReferences = async (
  db: LocalDatabaseInterface,
  hashes: readonly string[],
): Promise<GenerationArtifactReference[]> => {
  if (hashes.length === 0) {
    return [];
  }
  const placeholders = hashes.map(() => '?').join(', ');
  const result = await db.query({
    sql: `SELECT g.hash AS hash, g.candidate_id AS candidate_id, c.tag AS tag
          FROM generation_artifacts g
          JOIN generation_candidates c ON c.candidate_id = g.candidate_id
          WHERE g.hash IN (${placeholders})`,
    args: [...hashes],
  });

  const byHash = new Map<string, { candidateIds: Set<string>; tags: Set<string> }>();
  for (const row of result.rows) {
    const hash = row.hash as string;
    const entry = byHash.get(hash) ?? { candidateIds: new Set<string>(), tags: new Set<string>() };
    entry.candidateIds.add(row.candidate_id as string);
    entry.tags.add(row.tag as string);
    byHash.set(hash, entry);
  }

  return hashes.map((hash) => {
    const entry = byHash.get(hash);
    return {
      hash,
      candidateIds: entry === undefined ? [] : [...entry.candidateIds],
      tags: entry === undefined ? [] : [...entry.tags],
    };
  });
};

/**
 * Deletes a candidate and its acceptance, reporting which of its bytes are now
 * unreferenced.
 *
 * Idempotent: deleting an already-deleted candidate reports `deleted: false`
 * and no orphaned hashes rather than throwing.
 */
export const deleteGenerationCandidate = async (
  db: LocalDatabaseInterface,
  candidateId: string,
): Promise<DeleteGenerationCandidateResult> => {
  const artifacts = await db.query({
    sql: 'SELECT DISTINCT hash FROM generation_artifacts WHERE candidate_id = ?',
    args: [candidateId],
  });
  const hashes = artifacts.rows.map((row) => row.hash as string);

  const existing = await db.query({
    sql: 'SELECT candidate_id FROM generation_candidates WHERE candidate_id = ?',
    args: [candidateId],
  });
  if (existing.rows.length === 0) {
    return { deleted: false, reason: 'not_found', orphanedHashes: [] };
  }

  await db.transaction([
    { sql: 'DELETE FROM generation_acceptances WHERE candidate_id = ?', args: [candidateId] },
    { sql: 'DELETE FROM generation_artifacts WHERE candidate_id = ?', args: [candidateId] },
    { sql: 'DELETE FROM generation_candidates WHERE candidate_id = ?', args: [candidateId] },
  ]);
  await db.flush?.();

  const references = await findArtifactReferences(db, hashes);
  const orphanedHashes = references
    .filter((entry) => entry.candidateIds.length === 0)
    .map((e) => e.hash);

  logger.debug('GenerationRecordStore.deleteCandidate', {
    candidateId,
    orphanedHashes,
  });

  return { deleted: true, orphanedHashes };
};

/** Every artifact hash a candidate owns (raw, prepared, references, report). */
export const listCandidateArtifacts = async (
  db: LocalDatabaseInterface,
  candidateId: string,
): Promise<GenerationArtifactRef[]> => {
  const result = await db.query({
    sql: 'SELECT hash, role FROM generation_artifacts WHERE candidate_id = ? ORDER BY role, hash',
    args: [candidateId],
  });
  return result.rows.map((row) => ({
    hash: row.hash as string,
    role: row.role as GenerationArtifactRole,
  }));
};
