// apps/frontend/hub/src/lib/server/api/asset_generation_artifacts.ts
//
// C-522 — private, owner-scoped artifact transfer for remote review.
//
// Remote review needs the creator's bytes on the Hub, and nothing else does.
// So the transfer is:
//   * explicitly opt-in per device (`artifact_upload_enabled`, default off);
//   * bounded (one artifact, one ceiling, checked before any byte is buffered);
//   * hash-claimed by the runner and *re-verified* on read, so a ticket can
//     never be used to serve bytes the owner did not receive;
//   * privately staged under `generation-staging/`, never under `assets/` —
//     `asset_community.ts` is the only publication path and this module does
//     not touch it;
//   * expiring, so a forgotten ticket does not become permanent storage.
//
// Contract: C-522 Hub and client access to the generation runner

import {
  generationDispatches,
  runnerArtifactTickets,
  runnerDevices,
} from '@aikami/backend-database';
import {
  GENERATION_RUNNER_SCHEMA_VERSION,
  RUNNER_ARTIFACT_MAX_BYTES,
  RUNNER_ARTIFACT_TICKET_TTL_MS,
  RunnerArtifactTicketRequestSchema,
} from '@aikami/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  authenticateDevice,
  type GenerationRunnerEnv,
  getSessionUserId,
  json,
  parseAgainst,
  parseJsonObject,
  type RunnerDeviceRow,
  reject,
  unauthorized,
} from './asset_generation_runner_shared.ts';

const schema = { generationDispatches, runnerArtifactTickets, runnerDevices };

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
};

/** Lowercase extension for a supported content type, or `.bin`. */
const extensionFor = (mimeType: string): string => EXTENSIONS[mimeType] ?? '.bin';

/**
 * The private staging key.
 *
 * Deliberately *not* `assets/<hash>`: the content-addressed public namespace is
 * written only by the moderation promotion path in `asset_community.ts`.
 */
const stagingKeyFor = (ownerAccountId: string, ticketId: string, mimeType: string): string =>
  `generation-staging/${ownerAccountId}/${ticketId}${extensionFor(mimeType)}`;

/** Whether this device may upload, and whether a bucket exists to hold it. */
const uploadAvailability = (
  env: GenerationRunnerEnv,
  device: RunnerDeviceRow,
): Response | undefined => {
  if (!device.artifactUploadEnabled) {
    return reject(
      'upload_disabled',
      'private artifact upload is off for this device — results stay local-only',
      403,
    );
  }
  if (!env.UPLOADS_BUCKET) {
    return reject(
      'upload_disabled',
      'this hub deployment has no private staging bucket — results stay local-only',
      503,
    );
  }
  return undefined;
};

/**
 * `POST /api/generation/runners/artifact` — request a private upload handle.
 *
 * The reply carries the staging key, which the runner then PUTs to. No bytes
 * move until the ticket exists and the fence still holds.
 */
export const handleRequestArtifactTicket = async (
  request: Request,
  env: GenerationRunnerEnv,
  rawBody: unknown,
): Promise<Response> => {
  const now = new Date();
  const auth = await authenticateDevice(request, env, now);
  if (auth instanceof Response) {
    return auth;
  }
  const unavailable = uploadAvailability(env, auth.row);
  if (unavailable) {
    return unavailable;
  }
  const body = parseAgainst(RunnerArtifactTicketRequestSchema, rawBody);
  if (!body || body.deviceId !== auth.row.id) {
    return reject('device_mismatch', 'the ticket must name the authenticated device', 400);
  }
  if (body.bytes > RUNNER_ARTIFACT_MAX_BYTES) {
    return reject(
      'upload_disabled',
      `artifact exceeds the ${RUNNER_ARTIFACT_MAX_BYTES}-byte private staging ceiling`,
      413,
    );
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
  if (dispatch.attempt !== body.attempt || dispatch.leaseId !== body.leaseId) {
    // A ticket minted against a superseded attempt would link a stale result to
    // a live dispatch, so the same fence that guards status guards artifacts.
    return reject('stale_attempt', 'this dispatch has moved past that attempt', 409);
  }

  const ticketId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + RUNNER_ARTIFACT_TICKET_TTL_MS);
  const stagingKey = stagingKeyFor(auth.row.ownerAccountId, ticketId, body.mimeType);
  await db.insert(runnerArtifactTickets).values({
    id: ticketId,
    ownerAccountId: auth.row.ownerAccountId,
    deviceId: auth.row.id,
    dispatchId: dispatch.id,
    candidateId: body.candidateId,
    kind: body.kind,
    mimeType: body.mimeType,
    bytes: body.bytes,
    sha256: body.sha256,
    stagingKey,
    createdAt: now,
    expiresAt,
    uploadedAt: null,
  });
  // The response is the *protocol* shape (GenerationArtifactTicket), built
  // from the values this handler derived — never a raw row echo, which would
  // leak column names and drift from the schema the runner types against.
  return json(
    {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      ticket: {
        schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
        ticketId,
        ownerAccountId: auth.row.ownerAccountId,
        deviceId: auth.row.id,
        dispatchId: dispatch.id,
        candidateId: body.candidateId,
        kind: body.kind,
        mimeType: body.mimeType,
        bytes: body.bytes,
        sha256: body.sha256,
        stagingKey,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      stagingKey,
    },
    201,
  );
};

/** `PUT /api/generation/artifacts/:ticketId` — upload the staged bytes. */
export const handleUploadArtifact = async (
  request: Request,
  env: GenerationRunnerEnv,
  ticketId: string,
): Promise<Response> => {
  const now = new Date();
  const auth = await authenticateDevice(request, env, now);
  if (auth instanceof Response) {
    return auth;
  }
  const unavailable = uploadAvailability(env, auth.row);
  if (unavailable || !env.UPLOADS_BUCKET) {
    return unavailable ?? reject('upload_disabled', 'no private staging bucket', 503);
  }
  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(runnerArtifactTickets)
    .where(eq(runnerArtifactTickets.id, ticketId))
    .limit(1);
  const ticket = rows[0];
  if (!ticket) {
    return reject('not_found', 'no such artifact ticket', 404);
  }
  if (ticket.deviceId !== auth.row.id) {
    return reject('device_mismatch', 'this ticket was minted for another device', 403);
  }
  if (ticket.expiresAt.getTime() <= now.getTime()) {
    return reject('ticket_expired', 'this artifact ticket has expired — request a new one', 410);
  }
  const declared = Number(request.headers.get('content-length') ?? 'NaN');
  if (Number.isFinite(declared) && declared > RUNNER_ARTIFACT_MAX_BYTES) {
    // Refuse before buffering — the whole body would otherwise be in memory.
    return reject('upload_disabled', 'artifact exceeds the private staging ceiling', 413);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > RUNNER_ARTIFACT_MAX_BYTES) {
    return reject('upload_disabled', 'artifact exceeds the private staging ceiling', 413);
  }
  // Byte identity is verified, not asserted: the runner's claimed hash must
  // match what actually arrived, or the ticket is refused.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== ticket.sha256) {
    return reject(
      'not_found',
      'the uploaded bytes do not match the hash the ticket was minted for',
      422,
    );
  }
  await env.UPLOADS_BUCKET.put(ticket.stagingKey, bytes, {
    httpMetadata: { contentType: ticket.mimeType },
  });
  await db
    .update(runnerArtifactTickets)
    .set({ uploadedAt: now })
    .where(eq(runnerArtifactTickets.id, ticket.id));
  return json({ ok: true, ticketId: ticket.id, sha256: actual, bytes: bytes.byteLength }, 200);
};

/** The owner-facing view of an uploaded artifact. */
const toTicketView = (ticket: typeof runnerArtifactTickets.$inferSelect) => ({
  schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
  ticketId: ticket.id,
  dispatchId: ticket.dispatchId,
  candidateId: ticket.candidateId,
  kind: ticket.kind,
  mimeType: ticket.mimeType,
  bytes: ticket.bytes,
  sha256: ticket.sha256,
  uploadedAt: ticket.uploadedAt?.toISOString() ?? ticket.createdAt.toISOString(),
  expiresAt: ticket.expiresAt.toISOString(),
  retrievalPath: `/api/generation/runner-artifacts/${ticket.id}/raw`,
});

/** `GET /api/generation/artifacts/:dispatchId` — this dispatch's tickets. */
export const handleListArtifacts = async (
  request: Request,
  env: GenerationRunnerEnv,
  dispatchId: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to review artifacts');
  }
  const now = new Date();
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
  if (rows[0] === undefined) {
    // Owner-scoped: a foreign dispatch is `not_found`, never `forbidden` —
    // a distinct status would confirm the dispatch exists.
    return reject('not_found', 'no such dispatch for this account', 404);
  }
  const tickets = await db
    .select()
    .from(runnerArtifactTickets)
    .where(
      and(
        eq(runnerArtifactTickets.dispatchId, dispatchId),
        eq(runnerArtifactTickets.ownerAccountId, accountId),
      ),
    )
    .orderBy(desc(runnerArtifactTickets.createdAt));
  return json(
    tickets.map((ticket) => ({
      ...toTicketView(ticket),
      // Expiry is evaluated on read, so a stale list cannot offer a link that
      // has already stopped working.
      expired: ticket.expiresAt.getTime() <= now.getTime(),
      uploaded: ticket.uploadedAt !== null,
    })),
    200,
  );
};

/** `GET /api/generation/artifacts/:ticketId/raw` — owner-scoped retrieval. */
export const handleGetArtifactRaw = async (
  request: Request,
  env: GenerationRunnerEnv,
  ticketId: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to retrieve an artifact');
  }
  const now = new Date();
  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(runnerArtifactTickets)
    .where(eq(runnerArtifactTickets.id, ticketId))
    .limit(1);
  const ticket = rows[0];
  if (!ticket || ticket.ownerAccountId !== accountId) {
    return reject('not_found', 'no such artifact for this account', 404);
  }
  if (ticket.expiresAt.getTime() <= now.getTime()) {
    return reject('ticket_expired', 'this artifact ticket has expired', 410);
  }
  const deviceRows = await db
    .select({ revokedAt: runnerDevices.revokedAt })
    .from(runnerDevices)
    .where(eq(runnerDevices.id, ticket.deviceId))
    .limit(1);
  if (deviceRows[0]?.revokedAt !== null && deviceRows[0]?.revokedAt !== undefined) {
    // Revocation blocks result retrieval. The bytes on the creator's own disk
    // are untouched — this only withdraws the Hub-side copy.
    return reject('device_revoked', 'this artifact belongs to a revoked device', 403);
  }
  if (!env.UPLOADS_BUCKET) {
    return reject('upload_disabled', 'no private staging bucket configured', 503);
  }
  const object = await env.UPLOADS_BUCKET.get(ticket.stagingKey);
  if (!object) {
    return reject('not_found', 'this artifact has not been uploaded yet', 404);
  }
  const body = await object.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': ticket.mimeType,
      // Private and short-lived: never a shared-cacheable public asset.
      'cache-control': 'private, no-store',
      'x-aikami-artifact-id': ticket.id,
      'x-aikami-candidate-id': ticket.candidateId,
    },
  });
};

/** Re-exported so the seam can record a completion without parsing stored JSON twice. */
export { parseJsonObject as parseStoredJson };
