// apps/frontend/hub/src/lib/server/api/asset_generation_dispatch.ts
//
// C-522 — the owner-facing half of Hub dispatch: enqueue, read, cancel-request.
//
// A creator's session creates a dispatch and reads its status; only a paired
// runner may *claim* it (`asset_generation_runner.ts`) or report on it
// (`asset_generation_runner.ts` / `asset_generation_seam.ts`). Splitting the
// two halves by audience is what keeps the ownership rule enforceable: every
// handler here is session-scoped to `owner_account_id`, every handler there is
// credential-scoped to `device_id`, and neither trusts the other's subject.
//
// Contract: C-522 Hub and client access to the generation runner

import { generationDispatches, runnerDevices } from '@aikami/backend-database';
import {
  GENERATION_RUNNER_SCHEMA_VERSION,
  GenerationDispatchSpecSchema,
  GenerationJobCancellationSchema,
} from '@aikami/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  type DispatchRow,
  type GenerationRunnerEnv,
  getSessionUserId,
  isTerminalStatus,
  json,
  parseAgainst,
  parseJsonObject,
  reject,
  toDispatchView,
  unauthorized,
} from './asset_generation_runner_shared.ts';

const schema = { generationDispatches, runnerDevices };

/** The maximal `candidateCount` a Hub dispatch record will accept. */
const MAX_CANDIDATES_PER_DISPATCH = 16;

/** What the creator's session submits to enqueue one job. */
type CreateDispatchBody = {
  deviceId: string;
  jobId: string;
  requestKey: string;
  effectiveSpecHash: string;
  attempt?: number;
  spec: unknown;
};

/** Read the enqueue body defensively — every field is security-relevant. */
const readCreateBody = (rawBody: unknown): CreateDispatchBody | undefined => {
  if (typeof rawBody !== 'object' || rawBody === null) {
    return undefined;
  }
  const body = rawBody as Record<string, unknown>;
  const { deviceId, jobId, requestKey, effectiveSpecHash, spec } = body;
  if (
    typeof deviceId !== 'string' ||
    typeof jobId !== 'string' ||
    typeof requestKey !== 'string' ||
    typeof effectiveSpecHash !== 'string' ||
    typeof spec !== 'object' ||
    spec === null
  ) {
    return undefined;
  }
  if (body.attempt !== undefined && typeof body.attempt !== 'number') {
    return undefined;
  }
  return {
    deviceId,
    jobId,
    requestKey,
    effectiveSpecHash,
    ...(body.attempt === undefined ? {} : { attempt: body.attempt }),
    spec,
  };
};

/** A stored dispatch projected to the wire shape. */
const viewOf = (row: DispatchRow) =>
  toDispatchView(row, parseAgainst(GenerationDispatchSpecSchema, parseJsonObject(row.specJson)));

/**
 * `POST /api/generation/dispatches` — route one job to one paired device.
 *
 * Idempotent on `(owner, jobId, attempt)`: re-submitting the same locked request
 * resolves to the existing dispatch with `200` instead of creating a second
 * one, which is what makes a reconnect after a dropped response safe. The
 * request body is the *allowlisted* spec — recipe/profile ids, reference ids,
 * seed, budget — so there is no field a caller could put a command or an
 * arbitrary engine URL in, and `GenerationDispatchSpecSchema` refuses unknown
 * keys outright.
 */
export const handleCreateDispatch = async (
  request: Request,
  env: GenerationRunnerEnv,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to dispatch a generation job');
  }
  const body = readCreateBody(rawBody);
  if (!body) {
    return reject('not_found', 'invalid dispatch request', 400);
  }
  const spec = parseAgainst(GenerationDispatchSpecSchema, body.spec);
  if (!spec) {
    return reject('not_found', 'the dispatch spec is not an allowlisted generation request', 422);
  }
  if (spec.candidateLimit > MAX_CANDIDATES_PER_DISPATCH) {
    return reject(
      'not_found',
      `candidateLimit exceeds the Hub ceiling of ${MAX_CANDIDATES_PER_DISPATCH}`,
      422,
    );
  }
  const attempt = body.attempt ?? 1;
  const now = new Date();
  const db = drizzle(env.DB, { schema });

  // Ownership AND device health are checked before the row exists, so a
  // dispatch can never be routed to a device the caller does not own or that
  // has been revoked.
  const devices = await db
    .select()
    .from(runnerDevices)
    .where(and(eq(runnerDevices.id, body.deviceId), eq(runnerDevices.ownerAccountId, accountId)))
    .limit(1);
  const device = devices[0];
  if (!device) {
    return reject('owner_mismatch', 'no such paired device for this account', 403);
  }
  if (device.revokedAt !== null) {
    return reject('device_revoked', 'this paired device has been revoked', 409);
  }

  const existing = await db
    .select()
    .from(generationDispatches)
    .where(
      and(
        eq(generationDispatches.ownerAccountId, accountId),
        eq(generationDispatches.jobId, body.jobId),
        eq(generationDispatches.attempt, attempt),
      ),
    )
    .limit(1);
  const prior = existing[0];
  if (prior) {
    // Same locked request, same attempt: return the record we already have.
    // This is the duplicate-submission guard AC-4 exercises.
    return json(viewOf(prior), 200);
  }

  const inserted = await db
    .insert(generationDispatches)
    .values({
      id: crypto.randomUUID(),
      ownerAccountId: accountId,
      deviceId: device.id,
      jobId: body.jobId,
      requestKey: body.requestKey,
      effectiveSpecHash: body.effectiveSpecHash,
      attempt,
      modality: spec.modality,
      specJson: JSON.stringify(spec),
      status: 'queued',
      candidateCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return json(viewOf(inserted[0]), 201);
};

/** `GET /api/generation/dispatches` — the owner's dispatch list. */
export const handleListDispatches = async (
  request: Request,
  env: GenerationRunnerEnv,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to list dispatches');
  }
  const rows = await drizzle(env.DB, { schema })
    .select()
    .from(generationDispatches)
    .where(eq(generationDispatches.ownerAccountId, accountId))
    .orderBy(desc(generationDispatches.updatedAt))
    .limit(100);
  return json(
    rows.map((row) => viewOf(row)),
    200,
  );
};

/** `GET /api/generation/dispatches/:dispatchId` — one owned dispatch. */
export const handleGetDispatch = async (
  request: Request,
  env: GenerationRunnerEnv,
  dispatchId: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to read a dispatch');
  }
  const rows = await drizzle(env.DB, { schema })
    .select()
    .from(generationDispatches)
    .where(
      and(
        eq(generationDispatches.id, dispatchId),
        eq(generationDispatches.ownerAccountId, accountId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    // Owner-scoped for the same reason the candidate read is: a distinct
    // `forbidden` would confirm that someone else's dispatch exists.
    return reject('not_found', 'no such dispatch for this account', 404);
  }
  return json(viewOf(row), 200);
};

/**
 * `POST /api/generation/dispatches/:dispatchId/cancel` — ask the runner to stop.
 *
 * Truthful cancellation, in two facts the C-519 vocabulary already separates:
 * this records a *request*. `confirmed` stays false until the runner reports
 * the provider's own receipt, because an engine with
 * `capabilities.cancel === false` cannot stop compute at all — and a Hub that
 * reported success would be lying about a GPU that is still running.
 *
 * A terminal dispatch is never silently reopened, and a running local job is
 * never destroyed: the runner decides, and its bytes stay its own.
 */
export const handleRequestDispatchCancel = async (
  request: Request,
  env: GenerationRunnerEnv,
  dispatchId: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to cancel a dispatch');
  }
  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(generationDispatches)
    .where(
      and(
        eq(generationDispatches.id, dispatchId),
        eq(generationDispatches.ownerAccountId, accountId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return reject('not_found', 'no such dispatch for this account', 404);
  }
  if (isTerminalStatus(row.status)) {
    return reject(
      'not_found',
      `this dispatch already finished as "${row.status}" — nothing to cancel`,
      409,
    );
  }
  const now = new Date();
  const existing = parseAgainst(
    GenerationJobCancellationSchema,
    parseJsonObject(row.cancellationJson),
  );
  const cancellation = {
    requested: true,
    requestedAt: now.toISOString(),
    confirmed: existing?.confirmed ?? false,
    ...(existing?.confirmedAt === undefined ? {} : { confirmedAt: existing.confirmedAt }),
    ...(existing?.reason === undefined ? {} : { reason: existing.reason }),
  };
  await db
    .update(generationDispatches)
    .set({ cancellationJson: JSON.stringify(cancellation), updatedAt: now })
    .where(eq(generationDispatches.id, row.id));
  return json(
    {
      ok: true,
      dispatchId: row.id,
      // The honest half: a request is not a confirmation.
      cancellation,
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
    },
    202,
  );
};
