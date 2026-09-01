// apps/backend/worker/src/index.ts
//
// Generic always-on host, deployed to a single Compute Engine VM (see
// scripts/src/lib/worker/deploy.ts) rather than Cloud Functions —
// Gateway-style connections (like the Discord bot below) need to stay
// open, a poor fit for a pay-per-invocation platform. Not named/scoped to
// Discord on purpose: this VM's job is "run always-on background workers,"
// today that's the Discord Gateway bot plus its Interactions Endpoint, but
// a future one plugs in the same way — declare its required env keys,
// start it here.
//
// The Elysia app is the VM's one HTTP surface — a plain `/health` check
// plus the Discord Interactions Endpoint (mounted from
// @aikami/backend-discord-bot, see docs/contracts/C-418-p2 OQ-3). Reaching
// it needs a Cloudflare-proxied domain in front of the VM's public IP —
// see README.md's "HTTP surface" section for the exact firewall/DNS steps,
// which are manual (console/dashboard) and not something this script does.
//
// TLS: this zone's Cloudflare SSL mode forwards proxied HTTPS traffic to
// the origin on port 443 over real TLS — there's no way to remap that
// without an Origin Rule (needs a token scope this repo's `cf` OAuth
// session doesn't have). So the server terminates TLS itself using a
// Cloudflare Origin CA certificate (WORKER_TLS_CERT/WORKER_TLS_KEY,
// Secret Manager only — never committed, never in .env.example's tracked
// defaults). Optional: if those two secrets aren't resolvable (e.g. local
// dev with no `.env`), falls back to plain HTTP on 8080 — Cloudflare is
// never in the loop for local runs anyway.

import {
  DISCORD_BOT_REQUIRED_ENV_KEYS,
  DISCORD_INTERACTIONS_REQUIRED_ENV_KEYS,
  DISCORD_NOTIFY_REQUIRED_ENV_KEYS,
  discordInteractions,
  discordNotify,
  startDiscordBot,
} from '@aikami/backend-discord-bot';
import { logger } from '@aikami/logger';
import { Elysia } from 'elysia';
import { loadEnv } from './env';

const WORKER_TLS_REQUIRED_ENV_KEYS = ['WORKER_TLS_CERT', 'WORKER_TLS_KEY'] as const;

/** Cloudflare Origin CA cert/key, if configured — undefined falls back to plain HTTP (local dev). */
async function resolveTls(): Promise<{ cert: string; key: string } | undefined> {
  try {
    const env = await loadEnv(WORKER_TLS_REQUIRED_ENV_KEYS);
    return { cert: env.WORKER_TLS_CERT, key: env.WORKER_TLS_KEY };
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const discordBotEnv = await loadEnv(DISCORD_BOT_REQUIRED_ENV_KEYS);
  const discordClient = await startDiscordBot(discordBotEnv);

  const interactionsEnv = await loadEnv(DISCORD_INTERACTIONS_REQUIRED_ENV_KEYS);
  const notifyEnv = await loadEnv(DISCORD_NOTIFY_REQUIRED_ENV_KEYS);
  const tls = await resolveTls();
  const port = Number(process.env.PORT ?? (tls ? 443 : 8080));
  const app = new Elysia()
    .get('/health', () => ({ status: 'ok' }))
    .use(discordInteractions(interactionsEnv))
    // Posts through the SAME live Client the Gateway bot above already
    // holds, so a relayed message appears as AiKami Bot — see TASK 4 and
    // notify/handler.ts's header comment.
    .use(discordNotify(discordClient, notifyEnv));

  if (tls) {
    app.listen({ port, tls });
  } else {
    app.listen(port);
  }

  logger.info(`worker: http${tls ? 's' : ''} listening on :${port}`);
}

main().catch((err) => {
  logger.error(`worker: fatal startup error: ${(err as Error).message}`);
  process.exit(1);
});
