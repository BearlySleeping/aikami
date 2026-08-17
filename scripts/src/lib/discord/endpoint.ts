// scripts/src/lib/discord/endpoint.ts
//
// Registers the worker VM's Discord Interactions Endpoint
// (apps/backend/worker + packages/backend/discord-bot's discordInteractions
// plugin — moved off Firebase Functions, docs/contracts/C-418-p2 OQ-3) as
// the application's Interactions Endpoint URL. Uses `PATCH /applications/@me`
// (bot-token authenticated) rather than the Developer Portal UI — Discord
// live-verifies the URL (sends a real PING, requires a PONG back) as part
// of that same call, so a 200 response here is proof the endpoint actually
// works — Cloudflare proxy, GCP firewall rule, and the VM's own signature
// verification all included, not just that something deployed.
//
// Production only — there is no staging worker VM (one Discord guild, no
// reason to run a second bot instance against it), so this always targets
// WORKER_URL regardless of the `mode` argument.
//
// Rarely-run setup step, same cadence as commands.ts's commands:sync — run
// it again any time the worker's URL changes (e.g. a new Cloudflare domain).

import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { WORKER_URL } from '../../../../packages/shared/constants/src/index.ts';
import { initScriptsEnv } from '../env/scripts_env';

export async function syncInteractionsEndpointUrl(mode = 'production'): Promise<void> {
  initScriptsEnv(mode);

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN not set — see scripts/.env.example.');
  }

  const url = `${WORKER_URL}/discord/interactions`;

  const rest = new REST({ version: '10' }).setToken(token);
  // Discord PINGs `url` synchronously as part of this PATCH — a successful
  // response means the endpoint is live and verifying signatures correctly,
  // not just that it's reachable.
  await rest.patch(Routes.currentApplication(), { body: { interactions_endpoint_url: url } });
}
