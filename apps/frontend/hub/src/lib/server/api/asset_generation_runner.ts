// apps/frontend/hub/src/lib/server/api/asset_generation_runner.ts
//
// C-522 — the paired-runner half of Hub generation.
//
// The Hub can never dial the creator's machine: a Worker `fetch` to
// `127.0.0.1` hits the Worker's own isolate, and a runner behind NAT/CGNAT has
// no inbound path at all. So the whole conversation is runner-initiated —
// pairing, claim, status/cancel delivery, artifact upload — and the Hub stays
// stateless per request. `apps/frontend/hub/wrangler.jsonc` declares no
// Cloudflare Queue and no Durable Object; this path deliberately needs neither.
//
// Concurrency safety comes from D1, not from an isolate-local counter:
//   * a claim is `UPDATE ... WHERE status='queued' AND lease_id IS NULL`, and
//     is honored only when D1 reports exactly one changed row;
//   * `generation_dispatches.lease_id` is UNIQUE, so a second writer cannot
//     mint the same lease id for a different dispatch;
//   * every status update must echo the dispatch's `attempt` *and* the
//     `leaseId` it holds — the C-519 fence, expressed through the shared
//     `GenerationLease` rather than a second lease shape.
//
// Contract: C-522 Hub and client access to the generation runner

import { generationDispatches, runnerDevices, runnerPairingCodes } from '@aikami/backend-database';
import {
  GENERATION_RUNNER_SCHEMA_VERSION,
  RUNNER_LIVENESS_WINDOW_MS,
  RUNNER_PAIRING_CODE_TTL_MS,
  RUNNER_TOKEN_TTL_MS,
  RunnerClaimRequestSchema,
  RunnerPairRequestSchema,
  RunnerStatusUpdateSchema,
} from '@aikami/schemas';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  assertDispatchDevice,
  authenticateDevice,
  type DispatchRow,
  type GenerationRunnerEnv,
  getSessionUserId,
  isDeviceOnline,
  isTerminalStatus,
  json,
  parseAgainst,
  parseJsonObject,
  parseStringArray,
  reject,
  resolveGenerationRunnerEnv,
  sha256Hex,
  toDeviceSummary,
  toDispatchView,
  unauthorized,
} from './asset_generation_runner_shared.ts';

export type { GenerationRunnerEnv };
export { resolveGenerationRunnerEnv };

const schema = { generationDispatches, runnerDevices, runnerPairingCodes };

// ── Credentials ──────────────────────────────────────────────────────────

/**
 * A pairing code a human reads off the Hub and types into the runner.
 *
 * Crockford-ish alphabet — no `0`/`O`/`1`/`I` — so a misread is impossible
 * rather than merely unlikely.
 */
const mintPairingCode = (): string => {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
};

/** `rt_<deviceId>.<48 hex>` — the bearer credential a runner presents. */
const mintRunnerToken = (deviceId: string): string => {
  const secret = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `rt_${deviceId}.${secret}`;
};

// ── Owner-facing: pairing codes and the paired-device list ───────────────

/** `POST /api/generation/runners/pairing-code` — mint a short-lived code. */
export const handleCreatePairingCode = async (
  request: Request,
  env: GenerationRunnerEnv,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to pair a runner');
  }
  const now = new Date();
  const code = mintPairingCode();
  const expiresAt = new Date(now.getTime() + RUNNER_PAIRING_CODE_TTL_MS);
  await drizzle(env.DB, { schema }).insert(runnerPairingCodes).values({
    code,
    ownerAccountId: accountId,
    createdAt: now,
    expiresAt,
    consumedAt: null,
    deviceId: null,
  });
  return json(
    {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      code,
      expiresAt: expiresAt.toISOString(),
      // The exact command, so the Creator Studio can show it without the docs
      // and the shipped CLI drifting apart.
      command: `bun run --cwd apps/backend/local-stack runner:pair --hub <HUB_ORIGIN> --code ${code}`,
    },
    201,
  );
};

/** `GET /api/generation/runners` — the creator-visible paired-device list. */
export const handleListRunners = async (
  request: Request,
  env: GenerationRunnerEnv,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to list paired devices');
  }
  const now = new Date();
  const rows = await drizzle(env.DB, { schema })
    .select()
    .from(runnerDevices)
    .where(eq(runnerDevices.ownerAccountId, accountId))
    .orderBy(desc(runnerDevices.lastSeenAt));
  return json(
    rows.map((row) => toDeviceSummary(row, now)),
    200,
  );
};

/** `DELETE /api/generation/runners/:deviceId` — revoke one paired device. */
export const handleRevokeRunner = async (
  request: Request,
  env: GenerationRunnerEnv,
  deviceId: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to revoke a paired device');
  }
  const rows = await drizzle(env.DB, { schema })
    .update(runnerDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(runnerDevices.id, deviceId), eq(runnerDevices.ownerAccountId, accountId)))
    .returning();
  const row = rows[0];
  if (!row) {
    return reject('not_found', 'no such paired device for this account', 404);
  }
  // Revocation stops new claims and result retrieval immediately. A job
  // already running locally keeps its result — see `handleUpdateStatus`, which
  // refuses *new* work rather than discarding an existing local outcome.
  return json(toDeviceSummary(row, new Date()), 200);
};

/** `POST /api/generation/runners/:deviceId/artifact-upload` — toggle upload. */
export const handleSetRunnerArtifactUpload = async (
  request: Request,
  env: GenerationRunnerEnv,
  deviceId: string,
  rawBody: unknown,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to change artifact upload');
  }
  const body = (rawBody ?? {}) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') {
    return reject('not_found', '`enabled` must be a boolean', 400);
  }
  const rows = await drizzle(env.DB, { schema })
    .update(runnerDevices)
    .set({ artifactUploadEnabled: body.enabled })
    .where(and(eq(runnerDevices.id, deviceId), eq(runnerDevices.ownerAccountId, accountId)))
    .returning();
  const row = rows[0];
  if (!row) {
    return reject('not_found', 'no such paired device for this account', 404);
  }
  return json(toDeviceSummary(row, new Date()), 200);
};

// ── Runner-facing: pairing ───────────────────────────────────────────────

/** `POST /api/generation/runners/pair` — consume a pairing code. */
export const handlePairRunner = async (
  _request: Request,
  env: GenerationRunnerEnv,
  rawBody: unknown,
): Promise<Response> => {
  const body = parseAgainst(RunnerPairRequestSchema, rawBody);
  if (!body) {
    return reject(
      'invalid_request',
      'the pairing request does not match the runner protocol schema',
      400,
    );
  }
  const now = new Date();
  const db = drizzle(env.DB, { schema });

  const codes = await db
    .select()
    .from(runnerPairingCodes)
    .where(eq(runnerPairingCodes.code, body.code))
    .limit(1);
  const codeRow = codes[0];
  if (!codeRow || codeRow.consumedAt !== null || codeRow.expiresAt.getTime() <= now.getTime()) {
    // Unknown, replayed and expired are deliberately one answer — a distinct
    // "already used" would confirm a guessed code.
    return reject('pairing_code_invalid', 'this pairing code is invalid or has expired', 403);
  }

  // Consume the code by CAS: two runners racing the same code cannot both win.
  const consumed = await env.DB.prepare(
    'UPDATE runner_pairing_codes SET consumed_at = ?, device_id = ? WHERE code = ? AND consumed_at IS NULL',
  )
    .bind(now.getTime(), body.deviceId, body.code)
    .run();
  if ((consumed.meta?.changes ?? 0) !== 1) {
    return reject('pairing_code_invalid', 'this pairing code has already been used', 403);
  }

  const token = mintRunnerToken(body.deviceId);
  const tokenHash = await sha256Hex(token);
  const tokenExpiresAt = new Date(now.getTime() + RUNNER_TOKEN_TTL_MS);
  const modalitiesJson = JSON.stringify(body.modalities);
  const resourceGroupsJson = JSON.stringify(body.resourceGroups);
  const artifactUploadEnabled = body.artifactUploadEnabled === true;
  // Re-pairing the same device id rotates its credential instead of cloning it.
  const rows = await db
    .insert(runnerDevices)
    .values({
      id: body.deviceId,
      ownerAccountId: codeRow.ownerAccountId,
      label: body.label,
      platform: body.platform,
      modalitiesJson,
      resourceGroupsJson,
      tokenHash,
      tokenExpiresAt,
      artifactUploadEnabled,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: runnerDevices.id,
      set: {
        tokenHash,
        tokenExpiresAt,
        label: body.label,
        platform: body.platform,
        modalitiesJson,
        resourceGroupsJson,
        artifactUploadEnabled,
        revokedAt: null,
        lastSeenAt: now,
      },
    })
    .returning();
  const stored = rows[0];
  return json(
    {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      ok: true,
      device: toDeviceSummary(stored, now),
      token,
      tokenExpiresAt: tokenExpiresAt.toISOString(),
    },
    201,
  );
};

// ── Runner-facing: claim ─────────────────────────────────────────────────

/** The oldest queued dispatch for a device, restricted to its modalities. */
const findClaimable = async (
  env: GenerationRunnerEnv,
  deviceId: string,
  modalities: readonly string[],
): Promise<{ row: DispatchRow | undefined; queuedCount: number }> => {
  const queued = await drizzle(env.DB, { schema })
    .select()
    .from(generationDispatches)
    .where(
      and(
        eq(generationDispatches.deviceId, deviceId),
        eq(generationDispatches.status, 'queued'),
        isNull(generationDispatches.leaseId),
      ),
    )
    .orderBy(asc(generationDispatches.createdAt))
    .limit(8);
  // A device that cannot run this modality is skipped *before* the claim, so a
  // queued image job is never silently parked behind an audio-only runner.
  return {
    row: queued.find((candidate) => modalities.includes(candidate.modality)),
    queuedCount: queued.length,
  };
};

/**
 * `POST /api/generation/runners/claim` — take at most one queued dispatch.
 *
 * Returns 200 with `claimed: false` and a stated reason on an empty queue: a
 * runner polling on an interval must not have to treat "nothing to do" as an
 * error.
 */
export const handleClaimDispatch = async (
  request: Request,
  env: GenerationRunnerEnv,
  rawBody: unknown,
): Promise<Response> => {
  const now = new Date();
  const auth = await authenticateDevice(request, env, now);
  if (auth instanceof Response) {
    return auth;
  }
  const body = parseAgainst(RunnerClaimRequestSchema, rawBody);
  if (!body) {
    return reject('invalid_request', 'the claim does not match the runner protocol schema', 400);
  }
  if (body.deviceId !== auth.row.id) {
    return reject('device_mismatch', 'the claim must name the authenticated device', 403);
  }
  if (!parseStringArray(auth.row.resourceGroupsJson, 8).includes(body.resourceGroup)) {
    return reject(
      'capability_mismatch',
      `this device does not advertise resource group "${body.resourceGroup}"`,
      409,
    );
  }
  const modalities = parseStringArray(auth.row.modalitiesJson, 8);
  const { row: candidate, queuedCount } = await findClaimable(env, auth.row.id, modalities);
  if (!candidate) {
    return json({
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      claimed: false,
      reason:
        queuedCount > 0
          ? 'queued dispatches exist but none matches this device capability'
          : 'no queued dispatch for this device',
    });
  }

  const leaseId = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + body.leaseTtlMs);
  // The CAS. `meta.changes === 1` is the entire arbitration: D1 serializes the
  // write, so exactly one isolate can move a queued row to running.
  const claimed = await env.DB.prepare(
    `UPDATE generation_dispatches
        SET status = 'running', lease_id = ?, lease_resource_group = ?, lease_owner = ?,
            lease_pid = ?, lease_acquired_at = ?, lease_expires_at = ?, claimed_at = ?, updated_at = ?
      WHERE id = ? AND attempt = ? AND status = 'queued' AND lease_id IS NULL`,
  )
    .bind(
      leaseId,
      body.resourceGroup,
      auth.row.id,
      0,
      now.getTime(),
      leaseExpiresAt.getTime(),
      now.getTime(),
      now.getTime(),
      candidate.id,
      candidate.attempt,
    )
    .run();
  if ((claimed.meta?.changes ?? 0) !== 1) {
    // Another isolate won the same row between SELECT and UPDATE. Not an error
    // for this runner — the next poll simply finds the next dispatch.
    return json({
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      claimed: false,
      reason: 'another runner claimed the oldest queued dispatch first',
    });
  }

  const fence = {
    schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
    dispatchId: candidate.id,
    attempt: candidate.attempt,
    lease: {
      resourceGroup: body.resourceGroup,
      owner: auth.row.id,
      pid: 0,
      leaseId,
      acquiredAt: now.toISOString(),
      expiresAt: leaseExpiresAt.toISOString(),
    },
  };
  return json(
    {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      claimed: true,
      dispatch: toDispatchView(
        {
          ...candidate,
          status: 'running',
          leaseId,
          leaseResourceGroup: body.resourceGroup,
          leaseOwner: auth.row.id,
          leasePid: 0,
          leaseAcquiredAt: now,
          leaseExpiresAt,
        },
        parseJsonObject(candidate.specJson),
      ),
      fence,
    },
    200,
  );
};

// ── Runner-facing: status + cancellation delivery ────────────────────────

/** The `attempt`/`leaseId` fence, expressed as a refusal when it fails. */
const fenceRejection = (
  row: DispatchRow,
  body: { attempt: number; leaseId: string },
  now: Date,
): Response | undefined => {
  if (row.attempt !== body.attempt) {
    return reject(
      'stale_attempt',
      `this dispatch is on attempt ${row.attempt}; the update named ${body.attempt}`,
      409,
    );
  }
  if (row.leaseId === null || row.leaseId !== body.leaseId) {
    return reject('lease_not_held', 'this dispatch no longer holds that lease', 409);
  }
  if (row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() <= now.getTime()) {
    // Expiry blocks *new* claims and result retrieval; it never destroys the
    // local result, so this is a reconcile signal, not a delete.
    return reject('lease_expired', 'the held lease has expired — reconcile before reporting', 409);
  }
  return undefined;
};

/**
 * Dispatch ids a device holds that carry an unconfirmed cancel request.
 *
 * 🔴 Two deliberate inclusions, both load-bearing:
 *
 *   * A **terminal** dispatch is excluded. A cancel ask is only meaningful while
 *     there is compute to stop, and leaving finished rows in the list would
 *     keep re-offering a cancellation that can never be satisfied.
 *   * The **caller's own** dispatch is NOT excluded from the answer (see
 *     `handleUpdateStatus`). The Hub cannot push, so a runner learns about a
 *     cancel only from the reply to its own status heartbeat — and the
 *     heartbeat necessarily names the dispatch it is asking about. Filtering
 *     that id out makes cancellation undeliverable for exactly the dispatch
 *     that needs it, which is how a running job ended up ignoring a cancel and
 *     running to completion.
 */
const pendingCancellationIds = async (
  env: GenerationRunnerEnv,
  deviceId: string,
): Promise<string[]> => {
  const rows = await drizzle(env.DB, { schema })
    .select({ id: generationDispatches.id })
    .from(generationDispatches)
    .where(
      and(
        eq(generationDispatches.deviceId, deviceId),
        sql`${generationDispatches.cancellationJson} LIKE '%"requested":true%'`,
        // Only unconfirmed asks on a dispatch that is still holding compute.
        sql`${generationDispatches.cancellationJson} NOT LIKE '%"confirmed":true%'`,
        sql`${generationDispatches.status} NOT IN ('succeeded', 'failed', 'cancelled', 'interrupted', 'awaiting_review', 'reconciliation_required')`,
      ),
    )
    .limit(32);
  return rows.map((row) => row.id);
};

/**
 * `POST /api/generation/runners/status` — report progress under the fence.
 *
 * Cancellation rides back on this response, because the Hub cannot push: a
 * runner behind CGNAT only ever sees replies to its own requests. A stale or
 * unfenced update is refused with a named code so the runner reconciles rather
 * than overwriting a newer attempt.
 */
export const handleUpdateStatus = async (
  request: Request,
  env: GenerationRunnerEnv,
  rawBody: unknown,
): Promise<Response> => {
  const now = new Date();
  const auth = await authenticateDevice(request, env, now);
  if (auth instanceof Response) {
    return auth;
  }
  const body = parseAgainst(RunnerStatusUpdateSchema, rawBody);
  if (!body) {
    return reject(
      'invalid_request',
      'the status update does not match the runner protocol schema',
      400,
    );
  }
  if (body.deviceId !== auth.row.id) {
    return reject('device_mismatch', 'the update must name the authenticated device', 403);
  }
  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(generationDispatches)
    .where(eq(generationDispatches.id, body.dispatchId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return reject('not_found', 'no such dispatch', 404);
  }
  if (row.ownerAccountId !== auth.row.ownerAccountId) {
    return reject('owner_mismatch', 'this dispatch belongs to another account', 403);
  }
  const wrongDevice = assertDispatchDevice({ dispatch: row, deviceId: auth.row.id });
  if (wrongDevice) {
    return wrongDevice;
  }
  const fenceFailure = fenceRejection(row, body, now);
  if (fenceFailure) {
    return fenceFailure;
  }

  const terminal = isTerminalStatus(body.status);
  await db
    .update(generationDispatches)
    .set({
      status: body.status,
      candidateCount: body.candidateCount,
      updatedAt: now,
      ...(body.candidateId === undefined ? {} : { candidateId: body.candidateId }),
      ...(body.preparedHash === undefined ? {} : { preparedHash: body.preparedHash }),
      ...(body.failure === undefined ? {} : { failureJson: JSON.stringify(body.failure) }),
      ...(body.cancellation === undefined
        ? {}
        : { cancellationJson: JSON.stringify(body.cancellation) }),
      // A terminal status releases the lease, so the device can take the next
      // job without waiting out the TTL.
      ...(terminal
        ? { leaseId: null, leaseResourceGroup: null, leaseOwner: null, leasePid: null }
        : {}),
    })
    .where(eq(generationDispatches.id, row.id));

  const pending = terminal ? [] : await pendingCancellationIds(env, auth.row.id);
  // The caller's own dispatch stays in the list while the ask is unconfirmed.
  // It is dropped only once this very update confirmed the provider-side stop,
  // at which point there is nothing left to ask for.
  const justConfirmed = body.cancellation?.confirmed === true;
  return json({
    schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
    ok: true,
    status: body.status,
    candidateCount: body.candidateCount,
    pendingCancellationDispatchIds: pending.filter((id) => !(id === row.id && justConfirmed)),
  });
};

// ── Owner-facing: availability ───────────────────────────────────────────

/**
 * `GET /api/generation/runners/availability` — the transport a creator can
 * actually use, as a typed reason rather than a boolean.
 *
 * AC-3 requires that a browser which cannot reach loopback lands on an
 * actionable fallback instead of a false success. The Hub can only speak for
 * the paired path (it cannot probe the creator's loopback), so it reports
 * `paired_outbound` when a device is online and otherwise names *why* — and
 * always with something the creator can do next.
 */
export const handleRunnerAvailability = async (
  request: Request,
  env: GenerationRunnerEnv,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized('sign in to resolve generation availability');
  }
  const now = new Date();
  const rows = await drizzle(env.DB, { schema })
    .select()
    .from(runnerDevices)
    .where(eq(runnerDevices.ownerAccountId, accountId))
    .orderBy(desc(runnerDevices.lastSeenAt));

  const live = rows.filter((row) => row.revokedAt === null);
  const online = live.filter((row) => isDeviceOnline(row, now));
  const device = online[0];
  if (device) {
    return json({
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      available: true,
      mode: 'paired_outbound',
      deviceId: device.id,
    });
  }
  if (rows.length > 0 && live.length === 0) {
    return json({
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      available: false,
      mode: 'unavailable',
      code: 'runner_revoked',
      reason: 'every paired device has been revoked',
      remedy:
        'Pair the machine again from Studio → Generation and copy the new code into `runner:pair`.',
    });
  }
  if (live.length > 0) {
    return json({
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      available: false,
      mode: 'unavailable',
      code: 'runner_offline',
      reason: `no paired device has polled within ${Math.round(RUNNER_LIVENESS_WINDOW_MS / 1000)}s`,
      remedy: 'Start the runner on the paired machine, or generate locally in the editor.',
    });
  }
  return json({
    schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
    available: false,
    mode: 'unavailable',
    code: 'no_runner_paired',
    reason: 'no runner is paired to this account',
    remedy: 'Create a pairing code and run `bun run --cwd apps/backend/local-stack runner:pair`.',
  });
};
