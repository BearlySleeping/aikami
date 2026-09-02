// apps/frontend/hub/src/lib/server/api/storage.ts
//
// C-426: R2 object storage mediated by the hub, gated by a verified Better
// Auth session. The client never touches R2 credentials — it calls these
// endpoints and the hub reads/writes `env.SAVES_BUCKET` directly (the same
// Worker binding `save_backup.ts` uses).
//
// Objects live at `users/{uid}/{filename}` in the SAVES_BUCKET R2 bucket.
// Every read/write is session-verified — a signed-out or session-invalid
// request is rejected with 401 and never reaches R2.
//
// C-454: key construction uses the shared userObjectKey spec from
// @aikami/schemas instead of inline template literals. The read-path
// authorization check uses parse() to validate key shape, then compares
// the parsed uid against the session's accountId explicitly (ownership is
// proven by the session, not by the key shape alone).

import { userObjectKey } from '@aikami/schemas';
import { getBetterAuth } from './better_auth.ts';

type StorageEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare R2 binding name
  SAVES_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

let _env: StorageEnv | undefined;

/** Inject the per-request Worker env (called by the catch-all route). */
export const setStorageEnv = (envValue: StorageEnv | undefined): void => {
  _env = envValue;
};

/** The injected env, or undefined when the hub is not on a Worker yet. */
export const getStorageEnv = (): StorageEnv | undefined => _env;

/** Per-object size cap (16 MiB) — reject oversized uploads before buffering. */
export const MAX_STORAGE_BYTES = 16 * 1024 * 1024;

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

const badRequest = (message: string): Response =>
  new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });

/**
 * POST /api/storage/upload?path=<key>
 *
 * Session-verified. The raw request body is the file bytes. Uploads to R2
 * under the given key (scoped to the signed-in user's `users/{uid}/` prefix).
 */
export const handleStorageUpload = async (request: Request, env: StorageEnv): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) {
    return badRequest('invalid-argument');
  }

  // Scope every object under the signed-in user's prefix so one user can
  // never read/write another's objects.
  // C-454: uses the shared userObjectKey spec instead of inline template literal.
  const sanitizedPath = path.replace(/^users\/[^/]+\//, '');
  const scopedPath = userObjectKey.build({ uid: accountId, filename: sanitizedPath });

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_STORAGE_BYTES) {
    return new Response(JSON.stringify({ error: 'storage_too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return badRequest('invalid-argument');
  }
  if (bytes.byteLength > MAX_STORAGE_BYTES) {
    return new Response(JSON.stringify({ error: 'storage_too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  const contentType = request.headers.get('content-type') ?? 'application/octet-stream';
  await env.SAVES_BUCKET.put(scopedPath, bytes, {
    httpMetadata: { contentType },
  });

  return new Response(JSON.stringify({ path: scopedPath }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};

/**
 * GET /api/storage/url?path=<key>
 *
 * Session-verified. Resolves a public download URL for an object. The object
 * must belong to the signed-in user (scoped under `users/{uid}/`).
 */
export const handleStorageUrl = async (request: Request, env: StorageEnv): Promise<Response> => {
  const accountId = await getSessionUserId(request);
  if (!accountId) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) {
    return badRequest('invalid-argument');
  }

  // C-454: use schema parse to validate key shape, then compare the parsed
  // uid against the session's accountId (ownership is proven by the session,
  // not by the key shape alone — a parse success for a different uid must
  // still be rejected).
  const parsed = userObjectKey.parse(path);
  if (!parsed || parsed.uid !== accountId) {
    return unauthorized();
  }

  const object = await env.SAVES_BUCKET.get(path);
  if (!object) {
    return new Response(JSON.stringify({ error: 'not-found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // R2 public URL — the bucket is configured with a public custom domain
  // (e.g. assets.bearlysleeping.com). Objects are unguessable (uuid paths).
  const publicBase = url.origin;
  return new Response(JSON.stringify({ url: `${publicBase}/r2/${encodeURIComponent(path)}` }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
