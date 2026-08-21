// apps/frontend/hub/src/lib/server/api/save_backup.ts
//
// C-426 AC-6/AC-7: Turso save backup/restore to R2, gated by a verified
// Better Auth session.
//
// Objects live at `saves/{accountId}/{timestamp}-{filename}` in the
// SAVES_BUCKET R2 bucket. Every read/write is session-verified (I-10) — a
// signed-out or session-invalid request is rejected with 401 and never
// reaches R2. The `account_backups` metadata row is written ONLY after the
// R2 PUT succeeds (AC-6 idempotency: a failed upload must not leave a
// partial/corrupt row).
//
// R2 access uses the Worker binding directly (env.SAVES_BUCKET.put/get) —
// the hub mediates the upload/download behind the session guard. This is the
// Worker-native equivalent of a presigned URL: the object is never public or
// guessable, and every request is authenticated.

import { d1 } from '@aikami/backend-database';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { getBetterAuth } from './better_auth.ts';

type SaveBackupEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: import('@cloudflare/workers-types').D1Database;
  // biome-ignore lint/style/useNamingConvention: Cloudflare R2 binding name
  SAVES_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

let _env: SaveBackupEnv | undefined;

/** Inject the per-request Worker env (called by the catch-all route). */
export const setSaveBackupEnv = (envValue: SaveBackupEnv | undefined): void => {
  _env = envValue;
};

/** The injected env, or undefined when the hub is not on a Worker yet. */
export const getSaveBackupEnv = (): SaveBackupEnv | undefined => _env;

/** Per-backup size cap (64 MiB) — reject oversized uploads before buffering. */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

/** Per-account backup count cap — a simple storage-quota guard. */
export const MAX_BACKUPS_PER_ACCOUNT = 20;

/**
 * R2 object key for a given account. The backup UUID is embedded so each
 * upload gets a collision-resistant key even within the same millisecond.
 */
export const saveKeyFor = (
  accountId: string,
  timestamp: number,
  filename: string,
  backupId: string,
): string => `saves/${accountId}/${timestamp}-${backupId}-${filename}`;

/** SHA-256 hex digest of the uploaded bytes (for the checksum column). */
const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Resolve the signed-in user id from the request, or undefined. */
const getSessionUserId = async (request: Request): Promise<string | undefined> => {
  const auth = getBetterAuth();
  if (!auth) {
    return undefined;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id;
};

const unauthorized = (): Response =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

/**
 * POST /api/saves/backup?filename=<name>
 *
 * Session-verified. The raw request body is the Turso DB file bytes. Uploads
 * to R2 and records an `account_backups` metadata row (written only after
 * the PUT succeeds).
 */
export const handleCreateBackup = async (
  request: Request,
  env: SaveBackupEnv,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get('filename');
  if (!filename) {
    return new Response(JSON.stringify({ error: 'invalid-argument' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Reject oversized uploads up front via Content-Length, then again after
  // reading, so we never buffer an unbounded body.
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BACKUP_BYTES) {
    return new Response(JSON.stringify({ error: 'backup_too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return new Response(JSON.stringify({ error: 'invalid-argument' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (bytes.byteLength > MAX_BACKUP_BYTES) {
    return new Response(JSON.stringify({ error: 'backup_too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Storage-quota guard: cap the number of backups per account.
  const db = drizzle(env.DB, { schema: d1 });
  const existing = await db
    .select({ id: d1.accountBackups.id })
    .from(d1.accountBackups)
    .where(eq(d1.accountBackups.accountId, accountId));
  if (existing.length >= MAX_BACKUPS_PER_ACCOUNT) {
    return new Response(JSON.stringify({ error: 'quota_exceeded' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  const backupId = crypto.randomUUID();
  const timestamp = Date.now();
  const r2Key = saveKeyFor(accountId, timestamp, filename, backupId);

  // Upload to R2 first — only on success do we write the metadata row.
  await env.SAVES_BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

  const sizeBytes = bytes.byteLength;
  const checksumSha256 = await sha256Hex(bytes);
  try {
    const row = await db
      .insert(d1.accountBackups)
      .values({
        id: backupId,
        accountId,
        r2Key,
        sizeBytes,
        checksumSha256,
        createdAt: new Date(),
      })
      .returning();

    return new Response(JSON.stringify({ backupId: row[0].id, r2Key }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    // Metadata insert failed — delete the already-uploaded R2 object so no
    // successful upload remains without a metadata row (AC-6 idempotency).
    await env.SAVES_BUCKET.delete(r2Key).catch(() => undefined);
    throw error;
  }
};

/**
 * GET /api/saves
 *
 * Session-verified. Lists the signed-in user's backups (metadata only).
 */
export const handleListBackups = async (
  request: Request,
  env: SaveBackupEnv,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }

  const db = drizzle(env.DB, { schema: d1 });
  const rows = await db
    .select()
    .from(d1.accountBackups)
    .where(eq(d1.accountBackups.accountId, accountId))
    .orderBy(d1.accountBackups.createdAt);

  return new Response(
    JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        r2Key: r.r2Key,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt,
      })),
    ),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

/**
 * GET /api/saves/:id
 *
 * Session-verified. Returns the backup bytes for the given backup id, but
 * only if it belongs to the signed-in user (a wrong-device restore must
 * never read another user's save).
 */
export const handleGetBackup = async (
  request: Request,
  env: SaveBackupEnv,
  backupId: string,
): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }

  const db = drizzle(env.DB, { schema: d1 });
  const rows = await db.select().from(d1.accountBackups).where(eq(d1.accountBackups.id, backupId));

  const row = rows[0];
  if (!row || row.accountId !== accountId) {
    return new Response(JSON.stringify({ error: 'not-found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const object = await env.SAVES_BUCKET.get(row.r2Key);
  if (!object) {
    return new Response(JSON.stringify({ error: 'not-found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(object.body, {
    status: 200,
    headers: { 'content-type': 'application/octet-stream' },
  });
};
