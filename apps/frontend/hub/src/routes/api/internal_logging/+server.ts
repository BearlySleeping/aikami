// apps/frontend/hub/src/routes/api/internal_logging/+server.ts
//
// Browser log ingestion endpoint (mirrors nordclaw's internal_logging
// route). The shared frontend logger's HTTP sink
// (packages/shared/logger/src/lib/logger_browser.ts) POSTs buffered log
// batches here; this route re-emits them through the SSR logger, which
// writes Cloud Logging-compatible structured JSON to stdout/stderr in
// production (visible in Cloud Run) and pretty-prints in dev.
//
// This is a dedicated SvelteKit route, so it takes precedence over the
// `/api/[...slugs]` Elysia catch-all. It is also excluded from App Check
// enforcement in hooks.server.ts (appCheckExcludePaths) so log uploads
// are never blocked by a missing token.

import { sanitizeLogAppTag } from '@aikami/backend/svelte-kit/hooks_helpers';
import { json, type RequestHandler } from '@sveltejs/kit';
import { logger } from '$logger';
import { logContextStore } from '$loggerServer';

type LogEntryInput = {
  logLevel?: string;
  logType?: string;
  message?: string;
  data?: unknown;
};

type InternalLogsBody = {
  label?: string;
  /** Originating app id (PUBLIC_APP_ID), e.g. "hub" or "client" — see
   *  packages/shared/logger/src/lib/logger_browser.ts. Distinguishes
   *  hub's own browser-side logs from other apps forwarding here
   *  cross-origin (e.g. client, which has no server of its own). */
  app?: string;
  payload?: { batch?: LogEntryInput[] };
};

// ── Ingress limits ───────────────────────────────────────────────────────
//
// This endpoint is excluded from App Check (hooks.server.ts
// appCheckExcludePaths), so it is public by design. All limits below are
// enforced BEFORE emitEntry runs or the entry counter increments.

/** Maximum accepted request body size (bytes, approximate via string length). */
const MAX_BODY_LENGTH = 256 * 1024; // 256 KB
/** Maximum number of log entries per batch. */
const MAX_BATCH_ENTRIES = 1000;
/** Maximum serialized size of a single log entry (bytes, approximate). */
const MAX_ENTRY_LENGTH = 16 * 1024; // 16 KB

// Simple in-memory fixed-window rate limiter keyed by client IP. This is a
// single-instance guard — production deployments (Cloud Run) should layer
// edge rate limiting on top for multi-instance enforcement.
const RATE_LIMIT_MAX = 120; // requests per window
const RATE_LIMIT_WINDOW_MS = 60_000;
const _rateBuckets = new Map<string, { count: number; windowStart: number }>();

/**
 * In-memory fixed-window rate limiter keyed by client IP. Single-instance
 * guard — production (Cloud Run) should layer edge rate limiting on top.
 * Returns true when the key is over its window budget.
 */
const _rateLimited = (key: string): boolean => {
  const now = Date.now();
  const bucket = _rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    _rateBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return true;
  }
  bucket.count += 1;
  return false;
};

/** Approximate serialized size of a log entry (string length). */
const _entryLength = (entry: LogEntryInput): number => JSON.stringify(entry)?.length ?? 0;

/** Re-emits one browser log entry through the SSR logger (stdout sink). */
const emitEntry = (entry: LogEntryInput): void => {
  const message = entry.message ?? 'browser-log';
  const dataArgs = entry.data === undefined ? [] : [entry.data];

  switch (entry.logLevel) {
    case 'ERROR':
    case 'CRITICAL':
    case 'ALERT':
    case 'EMERGENCY':
      logger.error(message, ...dataArgs);
      break;
    case 'WARNING':
    case 'WARN':
      logger.warn(message, ...dataArgs);
      break;
    case 'INFO':
    case 'NOTICE':
      logger.info(message, ...dataArgs);
      break;
    case 'DEBUG':
      logger.debug(message, ...dataArgs);
      break;
    default:
      logger.log(message, ...dataArgs);
      break;
  }
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  // 1. Rate limit BEFORE reading the body — cheapest rejection for this
  //    public (App Check-excluded) endpoint.
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    (() => {
      try {
        return getClientAddress();
      } catch {
        return 'unknown';
      }
    })();
  if (_rateLimited(clientIp)) {
    return json({ error: 'Too Many Requests' }, { status: 429 });
  }

  // 2. Enforce the ingress request-size limit BEFORE JSON parsing.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ error: 'Failed to read request body' }, { status: 400 });
  }
  if (raw.length > MAX_BODY_LENGTH) {
    return json({ error: 'Request body too large' }, { status: 413 });
  }

  // 3. Malformed JSON and null/non-object bodies are client errors (400).
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'Invalid body' }, { status: 400 });
  }

  const batch = (body as InternalLogsBody).payload?.batch;
  if (!Array.isArray(batch)) {
    return json({ error: 'Invalid logs array' }, { status: 400 });
  }
  // Cap length defensively — this is a public, App Check-excluded field.
  const app = sanitizeLogAppTag((body as InternalLogsBody).app);

  // 4. Batch- and entry-size limits — all validated BEFORE emitEntry so
  //    nothing is emitted or counted for a rejected request.
  if (batch.length > MAX_BATCH_ENTRIES) {
    return json({ error: 'Log batch too large' }, { status: 400 });
  }
  for (const entry of batch) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return json({ error: 'Invalid log entry' }, { status: 400 });
    }
    if (_entryLength(entry as LogEntryInput) > MAX_ENTRY_LENGTH) {
      return json({ error: 'Log entry too large' }, { status: 400 });
    }
  }

  // 5. Tag the emitted entries as client-originated while inheriting the
  //    request context (sessionId, ip, route) that hooks.server.ts set up.
  //    The broad catch below reports 500 ONLY for ingestion failures — all
  //    validation errors were already returned above.
  try {
    const requestContext = logContextStore.getStore();
    let count = 0;
    await logContextStore.run({ ...requestContext, source: 'client', app }, () => {
      for (const entry of batch) {
        emitEntry(entry as LogEntryInput);
        count += 1;
      }
    });
    return json({ count, success: true });
  } catch (error) {
    logger.error('api/internal_logging: failed to ingest client logs', { error });
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
};
