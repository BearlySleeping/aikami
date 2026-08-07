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
  payload?: { batch?: LogEntryInput[] };
};

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

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as InternalLogsBody;
    const batch = body.payload?.batch;

    if (!Array.isArray(batch)) {
      return json({ error: 'Invalid logs array' }, { status: 400 });
    }

    // Tag the emitted entries as client-originated while inheriting the
    // request context (sessionId, ip, route) that hooks.server.ts set up.
    const requestContext = logContextStore.getStore();
    let count = 0;
    await logContextStore.run({ ...requestContext, source: 'client' }, () => {
      for (const entry of batch) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        emitEntry(entry);
        count += 1;
      }
    });

    return json({ count, success: true });
  } catch (error) {
    logger.error('api/internal_logging: failed to ingest client logs', { error });
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
};
