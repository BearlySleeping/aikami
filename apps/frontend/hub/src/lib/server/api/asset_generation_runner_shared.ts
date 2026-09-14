// apps/frontend/hub/src/lib/server/api/asset_generation_runner_shared.ts
//
// C-522 — helpers shared by the runner, artifact and seam modules.
//
// Split out for the same reason `asset_community_shared.ts` exists: the
// projection from a D1 row to the wire shape must be defined *once*, or the
// status view, the claim response and the completion seam can disagree about
// what a dispatch holds. Nothing here owns state.
//
// Contract: C-522 Hub and client access to the generation runner

import { generationDispatches, runnerDevices } from '@aikami/backend-database';
import {
  GENERATION_RUNNER_SCHEMA_VERSION,
  RUNNER_LIVENESS_WINDOW_MS,
  releasesLease,
} from '@aikami/schemas';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { getBetterAuth } from './better_auth.ts';

// ── Environment ──────────────────────────────────────────────────────────

/** The bindings the generation-runner surface needs. */
export type GenerationRunnerEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: import('@cloudflare/workers-types').D1Database;
  /**
   * Private staging bucket for uploaded preview artifacts. Absent ⇒ upload is
   * off, and a runner asking for a ticket is told `upload_disabled` rather
   * than handed a handle that cannot be written.
   */
  // biome-ignore lint/style/useNamingConvention: Cloudflare R2 binding name
  UPLOADS_BUCKET?: import('@cloudflare/workers-types').R2Bucket;
};

/** Drizzle's view of the three tables this surface touches. */
export const generationRunnerSchema = { generationDispatches, runnerDevices };

/** A device row as stored. */
export type RunnerDeviceRow = typeof runnerDevices.$inferSelect;
/** A dispatch row as stored. */
export type DispatchRow = typeof generationDispatches.$inferSelect;

/**
 * Resolves the runner environment from a request's Worker bindings.
 *
 * @returns The environment, or undefined when D1 is absent. Undefined is not
 * an error: generation is additive and never a boot dependency, so the routes
 * answer a typed `runner_unconfigured` rather than 500.
 */
export const resolveGenerationRunnerEnv = (
  env: App.Platform['env'] | undefined,
): GenerationRunnerEnv | undefined => {
  if (!env?.DB) {
    return undefined;
  }
  return {
    // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
    DB: env.DB,
    // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
    ...(env.UPLOADS_BUCKET ? { UPLOADS_BUCKET: env.UPLOADS_BUCKET } : {}),
  };
};

// ── Responses ────────────────────────────────────────────────────────────

/** A JSON response. */
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A refusal body — always a named code.
 *
 * The runner must be able to tell "my credential died" from "someone else won
 * the claim" from "my update is stale"; a bare 4xx collapses those into one
 * unactionable failure and invites a retry loop.
 */
export const reject = (code: string, message: string, status: number): Response =>
  json({ schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION, ok: false, code, message }, status);

/** The standard unauthenticated refusal. */
export const unauthorized = (message = 'a paired-runner credential is required'): Response =>
  reject('unauthorized', message, 401);

/** The standard "no D1 binding" refusal. */
export const runnerUnconfigured = (): Response =>
  reject('runner_unconfigured', 'this hub deployment has no generation store configured', 503);

// ── Small utilities ──────────────────────────────────────────────────────

/** Lowercase hex SHA-256. */
export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** A stored JSON string[] read defensively — a corrupt row degrades to `[]`. */
export const parseStringArray = (value: string, max: number): string[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, max);
  } catch {
    return [];
  }
};

/** A stored JSON object read defensively — a corrupt row degrades to `undefined`. */
export const parseJsonObject = (value: string | null): Record<string, unknown> | undefined => {
  if (value === null) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return { ...parsed };
  } catch {
    return undefined;
  }
};

/**
 * Validate against a shared TypeBox schema.
 *
 * `Value.Check` never throws, so a hostile body is a `undefined` rather than a
 * 500 — and because every shared schema is `additionalProperties: false`, an
 * unknown key is a refusal instead of a silently carried field.
 */
export const parseAgainst = <S extends TSchema>(
  schema: S,
  value: unknown,
): Static<S> | undefined => (Value.Check(schema, value) ? Value.Parse(schema, value) : undefined);

// ── Session ──────────────────────────────────────────────────────────────

/** Resolve the signed-in user id from the request, or undefined. */
export const getSessionUserId = async (request: Request): Promise<string | undefined> => {
  const auth = getBetterAuth();
  if (!auth) {
    return undefined;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id;
};

// ── Device authentication ────────────────────────────────────────────────

const RUNNER_TOKEN_PATTERN = /^rt_([A-Za-z0-9_-]{8,160})\.([a-f0-9]{48})$/;

/** Parse a `Bearer rt_<deviceId>.<secret>` header, or undefined. */
const parseRunnerToken = (request: Request): { deviceId: string; token: string } | undefined => {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  const token = header.slice('Bearer '.length).trim();
  const match = RUNNER_TOKEN_PATTERN.exec(token);
  if (!match) {
    return undefined;
  }
  return { deviceId: match[1], token };
};

/**
 * Resolve the calling device from its bearer token, or a refusal Response.
 *
 * Every authenticated call refreshes `last_seen_at`, which the creator-visible
 * list turns into an `online` flag — a runner that has gone away stops being
 * offered work instead of accumulating queued jobs forever.
 *
 * Revocation blocks new claims and result retrieval. It never touches a job
 * already running on the creator's machine: their bytes are theirs.
 */
export const authenticateDevice = async (
  request: Request,
  env: GenerationRunnerEnv,
  now: Date,
): Promise<{ row: RunnerDeviceRow } | Response> => {
  const parsed = parseRunnerToken(request);
  if (!parsed) {
    return unauthorized();
  }
  const db = drizzle(env.DB, { schema: generationRunnerSchema });
  const rows = await db
    .select()
    .from(runnerDevices)
    .where(eq(runnerDevices.tokenHash, await sha256Hex(parsed.token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.id !== parsed.deviceId) {
    return unauthorized('this credential matches no paired device');
  }
  if (row.revokedAt !== null) {
    return reject('device_revoked', 'this device was revoked by its owner', 403);
  }
  if (row.tokenExpiresAt.getTime() <= now.getTime()) {
    return reject('device_revoked', 'this device credential has expired — re-pair', 403);
  }
  await db.update(runnerDevices).set({ lastSeenAt: now }).where(eq(runnerDevices.id, row.id));
  return { row: { ...row, lastSeenAt: now } };
};

/**
 * A dispatch is routed to exactly ONE paired device, so only that device may
 * report on it.
 *
 * Ownership alone is not enough: a creator with two paired machines must not be
 * able to have machine B report status for — or release the lease of — machine
 * A's job. The claim is already device-scoped; without this, every follow-up
 * call (status, candidate, artifact ticket) was only owner-scoped, which quietly
 * broke the single-device routing guarantee.
 *
 * @returns A refusal when the caller is not the dispatch's device.
 */
export const assertDispatchDevice = (options: {
  dispatch: { deviceId: string };
  deviceId: string;
}): Response | undefined =>
  options.dispatch.deviceId === options.deviceId
    ? undefined
    : reject('device_mismatch', 'this dispatch is routed to a different paired device', 403);

// ── Projections ──────────────────────────────────────────────────────────

/** Whether a device is inside the liveness window (a Hub-side computation). */
export const isDeviceOnline = (row: RunnerDeviceRow, now: Date): boolean =>
  row.revokedAt === null && now.getTime() - row.lastSeenAt.getTime() <= RUNNER_LIVENESS_WINDOW_MS;

/**
 * The creator-visible device projection.
 *
 * Carries no `tokenHash` and no local path, so a read of the paired-device list
 * can never exfiltrate an existing credential.
 */
export const toDeviceSummary = (row: RunnerDeviceRow, now: Date) => ({
  schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
  deviceId: row.id,
  label: row.label,
  platform: row.platform,
  modalities: parseStringArray(row.modalitiesJson, 8),
  resourceGroups: parseStringArray(row.resourceGroupsJson, 8),
  artifactUploadEnabled: row.artifactUploadEnabled,
  createdAt: row.createdAt.toISOString(),
  lastSeenAt: row.lastSeenAt.toISOString(),
  revoked: row.revokedAt !== null,
  ...(row.revokedAt ? { revokedAt: row.revokedAt.toISOString() } : {}),
  online: isDeviceOnline(row, now),
});

/**
 * A status after which the dispatch holds no compute.
 *
 * 🔴 Delegates to the shared definition rather than repeating the list. The Hub
 * and the local runner's Hub executor must agree on which statuses end the
 * automatic work: when they did not, a blocked plan was reported as `queued`,
 * the Hub kept the lease, and the dispatch became permanently unclaimable with
 * no error shown anywhere.
 */
export const isTerminalStatus = (status: string): boolean => releasesLease(status);

/**
 * The wire projection of a dispatch.
 *
 * `lease` is reassembled into the shared C-519 `GenerationLease` from the five
 * flattened columns, so the Hub and the local store speak one lease shape and
 * one fence. `spec` is parsed from `spec_json`; a corrupt row degrades to an
 * explicit `undefined`-free projection rather than throwing mid-response.
 */
export const toDispatchView = (row: DispatchRow, spec: unknown) => {
  const lease =
    row.leaseId !== null &&
    row.leaseResourceGroup !== null &&
    row.leaseOwner !== null &&
    row.leaseAcquiredAt !== null &&
    row.leaseExpiresAt !== null
      ? {
          resourceGroup: row.leaseResourceGroup,
          owner: row.leaseOwner,
          // The Hub has no pid to report — the lease's process identity is the
          // device, and `pid` stays 0 rather than an invented value.
          pid: row.leasePid ?? 0,
          leaseId: row.leaseId,
          acquiredAt: row.leaseAcquiredAt.toISOString(),
          expiresAt: row.leaseExpiresAt.toISOString(),
        }
      : undefined;
  return {
    schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
    dispatchId: row.id,
    ownerAccountId: row.ownerAccountId,
    deviceId: row.deviceId,
    jobId: row.jobId,
    requestKey: row.requestKey,
    effectiveSpecHash: row.effectiveSpecHash,
    attempt: row.attempt,
    spec,
    status: row.status,
    ...(lease
      ? {
          fence: {
            schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
            dispatchId: row.id,
            attempt: row.attempt,
            lease,
          },
        }
      : {}),
    candidateCount: row.candidateCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.candidateId === null ? {} : { candidateId: row.candidateId }),
    ...(row.preparedHash === null ? {} : { preparedHash: row.preparedHash }),
    ...failureAndCancellation(row),
  };
};

/** The `failure` / `cancellation` halves of a dispatch projection. */
const failureAndCancellation = (
  row: DispatchRow,
): { failure?: Record<string, unknown>; cancellation?: Record<string, unknown> } => {
  const failure = parseJsonObject(row.failureJson);
  const cancellation = parseJsonObject(row.cancellationJson);
  return {
    ...(failure === undefined ? {} : { failure }),
    ...(cancellation === undefined ? {} : { cancellation }),
  };
};
