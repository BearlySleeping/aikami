// apps/frontend/hub/src/lib/server/api/asset_generation_seam.ts
//
// C-513 AC-9 → C-522: the generation/completion seam, now with a real store.
//
// The invariant C-513 pinned is unchanged and still the reason this module
// exists: a completed generation job records a **private candidate** and stops.
// Job completion, candidate acceptance and community publication are three
// separate decisions, and collapsing them would make every private generation
// an implicit publication.
//
// What C-522 adds is the store behind it. `handleRecordCandidate` is the
// runner-initiated completion report; it writes `generation_candidates` and
// nothing else. That table has no FK into `community_assets` and no public
// namespace key, so there is no branch here that *could* publish — the only
// route out remains the explicit reserve/upload path in `asset_community.ts`.
//
// Contract: C-513 AC-9; C-522 Hub and client access to the generation runner

import { generationCandidates, generationDispatches } from '@aikami/backend-database';
import {
  CandidateReviewRequestSchema,
  GENERATION_RUNNER_SCHEMA_VERSION,
  GenerationDispatchSpecSchema,
  RunnerCandidateReportSchema,
} from '@aikami/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logger } from '$logger';
import {
  assertDispatchDevice,
  authenticateDevice,
  type GenerationRunnerEnv,
  getSessionUserId,
  json,
  parseAgainst,
  parseJsonObject,
  reject,
  unauthorized,
} from './asset_generation_runner_shared.ts';

const schema = { generationCandidates, generationDispatches };

/**
 * A finished private generation job.
 *
 * Kept as the C-513-compatible projection: the fields a caller can state
 * without a store. `recordGenerationJobCompletion` stays a pure notice so a
 * caller outside a request (a CLI, a test) can assert the no-publish invariant
 * without a database.
 */
export type GenerationJobCompletion = {
  /** The C-522/C-519 job id. */
  jobId: string;
  /** The account the job ran for. */
  ownerAccountId: string;
  /** How many candidates the job produced (candidates are not publications). */
  candidateCount: number;
};

/**
 * Record a completed private generation job.
 *
 * Never publishes: a candidate is a local/Hub-private result until the owner
 * explicitly publishes it. This overload has no store and therefore cannot
 * write anything — `handleRecordCandidate` is the store-backed path.
 */
export const recordGenerationJobCompletion = (
  completion: GenerationJobCompletion,
): { published: 0 } => {
  logger.info('asset:generation job completed (private — not published)', {
    jobId: completion.jobId,
    ownerAccountId: completion.ownerAccountId,
    candidateCount: completion.candidateCount,
  });
  return { published: 0 };
};

/** The owner-visible projection of a private candidate row. */
const toCandidateView = (row: typeof generationCandidates.$inferSelect) => ({
  schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
  candidateId: row.id,
  dispatchId: row.dispatchId,
  jobId: row.jobId,
  itemId: row.itemId,
  recipeId: row.recipeId,
  providerProfileId: row.providerProfileId,
  effectiveSpecHash: row.effectiveSpecHash,
  attempt: row.attempt,
  seed: row.seed,
  preparedHash: row.preparedHash,
  status: row.status,
});

/**
 * `POST /api/generation/runners/candidates` — the runner reports a result.
 *
 * Idempotent by content address: `(owner, prepared_hash)` is unique, so
 * re-reporting the same bytes resolves to the same candidate row instead of
 * regenerating or duplicating. The row lands `pending` — review is the owner's
 * decision and publication is a separate act entirely.
 */
export const handleRecordCandidate = async (
  request: Request,
  env: GenerationRunnerEnv,
  rawBody: unknown,
): Promise<Response> => {
  const now = new Date();
  const auth = await authenticateDevice(request, env, now);
  if (auth instanceof Response) {
    return auth;
  }
  const body = parseAgainst(RunnerCandidateReportSchema, rawBody);
  if (!body) {
    return reject(
      'invalid_request',
      'the candidate report does not match the runner protocol schema',
      400,
    );
  }
  if (body.deviceId !== auth.row.id) {
    return reject('device_mismatch', 'the report must name the authenticated device', 403);
  }
  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(generationDispatches)
    .where(eq(generationDispatches.id, body.dispatchId))
    .limit(1);
  const dispatch = rows[0];
  if (!dispatch) {
    return reject('not_found', 'no such dispatch', 404);
  }
  if (dispatch.ownerAccountId !== auth.row.ownerAccountId) {
    return reject('owner_mismatch', 'this dispatch belongs to another account', 403);
  }
  const wrongDevice = assertDispatchDevice({ dispatch, deviceId: auth.row.id });
  if (wrongDevice) {
    return wrongDevice;
  }
  // The **attempt** is the fence for a candidate: a report naming a superseded
  // generation is refused, because it would attach a stale result to a live
  // dispatch.
  //
  // The lease is checked only while one is held. A terminal status legitimately
  // releases it, and a candidate that arrives after that release is not stale —
  // it is the same attempt reporting the bytes it just finished. Requiring a
  // released lease back would make the completion seam unreachable for the one
  // ordering the runner naturally produces, silently losing every candidate.
  if (dispatch.attempt !== body.attempt) {
    return reject('stale_attempt', 'this dispatch has moved past that attempt', 409);
  }
  if (dispatch.leaseId !== null && dispatch.leaseId !== body.leaseId) {
    return reject('lease_not_held', 'this dispatch no longer holds that lease', 409);
  }

  // The dispatch's allowlisted spec is the source of the lineage ids — never a
  // value the runner sent, which a compromised runner could otherwise inflate.
  const spec = parseAgainst(GenerationDispatchSpecSchema, parseJsonObject(dispatch.specJson));
  if (!spec) {
    // A dispatch row we cannot interpret is a Hub-side corruption, not a
    // runner error: refuse rather than write a half-populated candidate.
    return reject('not_found', 'this dispatch has an unreadable payload', 422);
  }

  // The private provenance projection: ids and a verified byte hash only. The
  // spec's prompt is the owner's private text and is not copied here, so a
  // later read of this row can never widen into a public projection.
  const provenanceJson = JSON.stringify({
    state: body.provenanceState,
    ...(body.engineId === undefined ? {} : { engineId: body.engineId }),
    ...(body.mimeType === undefined ? {} : { mimeType: body.mimeType }),
    ...(body.bytes === undefined ? {} : { bytes: body.bytes }),
    effectiveSpecHash: dispatch.effectiveSpecHash,
    providerProfileId: spec.providerProfileId,
    preparationProfile: spec.preparationProfile,
  });

  const inserted = await db
    .insert(generationCandidates)
    .values({
      id: body.candidateId,
      ownerAccountId: auth.row.ownerAccountId,
      dispatchId: dispatch.id,
      jobId: dispatch.jobId,
      itemId: spec.itemId,
      recipeId: spec.recipeId,
      providerProfileId: spec.providerProfileId,
      effectiveSpecHash: dispatch.effectiveSpecHash,
      attempt: dispatch.attempt,
      seed: body.seed,
      preparedHash: body.preparedHash,
      status: 'pending',
      provenanceJson,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [generationCandidates.ownerAccountId, generationCandidates.preparedHash],
      set: { updatedAt: now, status: 'pending' },
    })
    .returning();
  const candidate = inserted[0];
  return json(
    {
      ok: true,
      candidate: toCandidateView(candidate),
      // Stated explicitly, so no caller has to infer it from a missing field.
      published: 0,
    },
    201,
  );
};

/**
 * `GET /api/generation/candidates` — the owner's private pending results.
 *
 * Owner-scoped, with no cross-account branch: a foreign candidate is
 * `not_found`, never `forbidden` — a distinct status would confirm it exists.
 */
export const handleListCandidates = async (
  request: Request,
  env: GenerationRunnerEnv,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to review candidates');
  }
  const rows = await drizzle(env.DB, { schema })
    .select()
    .from(generationCandidates)
    .where(eq(generationCandidates.ownerAccountId, accountId))
    .orderBy(desc(generationCandidates.createdAt))
    .limit(200);
  return json(rows.map(toCandidateView), 200);
};

/**
 * `POST /api/generation/candidates/:candidateId/review` — accept or reject.
 *
 * A private decision. Accepting moves the candidate to `accepted` in the
 * owner's own list and stops there: `published` is always 0, and there is no
 * parameter that could make it otherwise.
 */
export const handleReviewCandidate = async (
  request: Request,
  env: GenerationRunnerEnv,
  candidateId: string,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to review a candidate');
  }
  const body = parseAgainst(CandidateReviewRequestSchema, rawBody ?? {});
  if (!body) {
    return reject('not_found', '`decision` must be "accept" or "reject"', 400);
  }
  const rows = await drizzle(env.DB, { schema })
    .update(generationCandidates)
    .set({
      status: body.decision === 'accept' ? 'accepted' : 'rejected',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(generationCandidates.id, candidateId),
        eq(generationCandidates.ownerAccountId, accountId),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) {
    return reject('not_found', 'no such candidate for this account', 404);
  }
  return json({ ok: true, candidate: toCandidateView(row), published: 0 }, 200);
};
