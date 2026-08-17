// apps/frontend/hub/src/lib/server/api/ask.ts
//
// POST /api/ask — public, unauthenticated "ask about Aikami" endpoint for
// the landing page (apps/frontend/site, static Firebase Hosting — no
// server of its own). Same underlying logic as the Discord Interactions
// Endpoint's /ask (packages/backend/discord-bot/src/lib/interactions),
// via the shared @aikami/backend-project-ai package.
//
// Behaviour contract, same shape as health_db.ts/catalog_stats.ts:
//   • Unconfigured (OPENROUTER_API_KEY/MODEL absent) → `{ error: 'unconfigured' }`
//     — no 500, no crash at module load.
//   • Rate-limited (see below) → `{ error: 'rate_limited' }`, HTTP 429.
//   • OpenRouter failure → `{ error: 'failed' }`.
//   • Success → `{ answer: string }`.
//
// Rate limiting: per-IP in-memory cooldown (@aikami/utils/rate_limit — the
// same primitive the Discord Interactions Endpoint uses, ASK_COOLDOWN_MS in
// packages/backend/discord-bot/src/lib/interactions/handler.ts). Cloud Run
// can run multiple instances, each with its own Map, so this is a
// best-effort speed bump against casual reload-spam, not a hard guarantee
// under concurrent instances — CORS (hooks.server.ts) is what stops
// arbitrary third-party sites from calling this at all.

import { getClientIp } from '@aikami/backend/svelte-kit/hooks_helpers';
import { askProjectAi } from '@aikami/backend-project-ai';
import { tryReserve } from '@aikami/utils';
import { env } from '$env/dynamic/private';
import { logger } from '$logger';

const ASK_COOLDOWN_MS = 15 * 1000;

export type AskResponse =
  | { answer: string }
  | { error: 'unconfigured' | 'rate_limited' | 'failed' };

export const handleAsk = async ({
  body,
  request,
  set,
}: {
  body: { question: string };
  request: Request;
  set: { status?: number | string };
}): Promise<AskResponse> => {
  const apiKey = env.OPENROUTER_API_KEY;
  const model = env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    logger.debug('/api/ask: unconfigured (OPENROUTER_API_KEY/OPENROUTER_MODEL absent)');
    return { error: 'unconfigured' };
  }

  const clientIp = getClientIp(request) ?? 'unknown';
  if (!tryReserve(`ask:${clientIp}`, ASK_COOLDOWN_MS)) {
    set.status = 429;
    return { error: 'rate_limited' };
  }

  try {
    const answer = await askProjectAi({ question: body.question, apiKey, model });
    return { answer };
  } catch (err) {
    logger.error(`/api/ask: failed: ${(err as Error).message}`);
    return { error: 'failed' };
  }
};
