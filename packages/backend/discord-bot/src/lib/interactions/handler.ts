// packages/backend/discord-bot/src/lib/interactions/handler.ts
//
// Discord Interactions Endpoint (HTTP webhook) — handles /ask. Unlike the
// Gateway bot (../../index.ts), Discord POSTs each slash-command
// interaction here directly; no persistent connection needed, but it still
// wants a real HTTPS URL. Mounted by apps/backend/worker alongside the
// Gateway bot so both surfaces share one always-on process — this used to
// be its own Firebase Cloud Function
// (apps/backend/firebase/src/controllers/api/discord_interactions.ts)
// before moving here (docs/contracts/C-418-p2, OQ-3).
//
// Timing: /ask does async work (OpenRouter), so the handler returns the
// DEFERRED ack immediately and completes the OpenRouter call + webhook edit
// in the background. The original Cloud Function had to `await` that work
// inline before returning, because Cloud Functions v2 only guarantees CPU
// for as long as the handler's promise is unresolved — "respond, then keep
// working after returning" would get frozen mid-flight there. That
// constraint doesn't apply to an always-on Bun process: the event loop
// keeps running regardless of whether any single request's handler has
// resolved, so firing the background work and returning immediately is the
// natural (and simpler) fit here.

import { askProjectAi } from '@aikami/backend-project-ai';
import { logger } from '@aikami/logger';
import { tryReserve } from '@aikami/utils/rate_limit';
import { Elysia } from 'elysia';
import { editOriginalInteractionResponse } from './respond';
import {
  type DiscordInteraction,
  type DiscordInteractionsEnv,
  EPHEMERAL_FLAG,
  getOptionValue,
  InteractionResponseType,
  InteractionType,
  interactionUserId,
} from './types';
import { verifyDiscordSignature } from './verify';

/** Same cooldown as the Gateway bot's in-thread conversational reply (message_create.ts) — one OpenRouter call per user per window, regardless of which surface they use. */
const ASK_COOLDOWN_MS = 10 * 1000;

/** Runs the deferred /ask completion in the background and edits the original response once done. */
function completeAsk(interaction: DiscordInteraction, env: DiscordInteractionsEnv): void {
  const question = getOptionValue(interaction, 'question');
  if (!question) {
    return;
  }
  askProjectAi({ question, apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL })
    .then((answer) =>
      editOriginalInteractionResponse(interaction.application_id, interaction.token, answer),
    )
    .catch((err) => {
      logger.error(`discord-bot/interactions: /ask failed: ${(err as Error).message}`);
      return editOriginalInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Sorry, I couldn't get an answer — try again in a bit.",
      );
    });
}

export function discordInteractions(env: DiscordInteractionsEnv) {
  return new Elysia().post('/discord/interactions', async ({ request, set }) => {
    // Read the exact raw bytes Discord signed — do not go through Elysia's
    // parsed `body`, which would re-serialize and break signature
    // verification.
    const rawBody = Buffer.from(await request.arrayBuffer());

    const signatureOk = verifyDiscordSignature({
      signature: request.headers.get('x-signature-ed25519') ?? undefined,
      timestamp: request.headers.get('x-signature-timestamp') ?? undefined,
      rawBody,
      publicKey: env.DISCORD_PUBLIC_KEY,
    });
    if (!signatureOk) {
      set.status = 401;
      return 'invalid request signature';
    }

    const interaction = JSON.parse(rawBody.toString('utf8')) as DiscordInteraction;

    if (interaction.type === InteractionType.PING) {
      return { type: InteractionResponseType.PONG };
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const command = interaction.data?.name;

      if (command === 'ask') {
        if (!getOptionValue(interaction, 'question')) {
          return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Missing `question` option.' },
          };
        }
        const userId = interactionUserId(interaction) ?? 'unknown';
        if (!tryReserve(`ask:${userId}`, ASK_COOLDOWN_MS)) {
          return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: 'Slow down a bit — try again in a few seconds.',
              flags: EPHEMERAL_FLAG,
            },
          };
        }
        completeAsk(interaction, env);
        return { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE };
      }

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `Unknown command "${command}".` },
      };
    }

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Unsupported interaction type.' },
    };
  });
}
