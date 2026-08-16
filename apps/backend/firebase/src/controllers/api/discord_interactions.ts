// apps/backend/firebase/src/controllers/api/discord_interactions.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors Discord's wire-format JSON keys (custom_id, max_length, ...)
//
// Discord Interactions Endpoint — handles /bug, /feature, /ask. This is an
// HTTP endpoint (Discord's "Interactions Endpoint URL" mode), NOT a Gateway
// bot: Discord POSTs each slash-command/modal-submit here and expects a
// response, no persistent connection needed. Register the deployed URL of
// this function as the app's Interactions Endpoint URL in the Discord
// Developer Portal, and register the commands themselves via
// `bun run discord commands:sync` (scripts/src/lib/discord/).
//
// Timing: every branch below that does async work (GitHub API, OpenRouter)
// responds DEFERRED immediately, then keeps awaiting inside this same
// handler invocation (never returns early) before editing the deferred
// response. That's deliberate — Cloud Functions v2 only guarantees CPU for
// as long as the handler's promise hasn't resolved, so "send a response,
// then keep working after the handler returns" would get frozen mid-flight.
// Awaiting everything inside one invocation avoids that trap entirely.

import { backendEnv, requireEnv } from '@aikami/backend/configs/environment';
import { onRequest } from '@snorreks/firestack';
import { askProjectAi } from '$lib/discord/ai_chat';
import { createGithubIssueFromDiscord } from '$lib/discord/github_issue';
import { editOriginalInteractionResponse } from '$lib/discord/respond';
import {
  type DiscordInteraction,
  getModalValue,
  getOptionValue,
  InteractionResponseType,
  InteractionType,
  interactionUsername,
} from '$lib/discord/types';
import { verifyDiscordSignature } from '$lib/discord/verify';
import { logger } from '$logger';

const BUG_MODAL_ID = 'bug_report_modal';
const FEATURE_MODAL_ID = 'feature_request_modal';

function reportModal(customId: string, title: string): unknown {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: customId,
      title,
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'title',
              style: 1,
              label: 'Title',
              required: true,
              max_length: 100,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'description',
              style: 2,
              label: 'Description (what / steps to reproduce)',
              required: true,
              max_length: 1500,
            },
          ],
        },
      ],
    },
  };
}

export default onRequest(async (request, response) => {
  const publicKey = requireEnv(backendEnv.DISCORD_PUBLIC_KEY, 'DISCORD_PUBLIC_KEY');

  const signatureOk = verifyDiscordSignature({
    signature: request.get('X-Signature-Ed25519'),
    timestamp: request.get('X-Signature-Timestamp'),
    rawBody: request.rawBody,
    publicKey,
  });
  if (!signatureOk) {
    response.status(401).send('invalid request signature');
    return;
  }

  const interaction = request.body as DiscordInteraction;

  if (interaction.type === InteractionType.PING) {
    response.status(200).json({ type: InteractionResponseType.PONG });
    return;
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const command = interaction.data?.name;

    if (command === 'bug') {
      response.status(200).json(reportModal(BUG_MODAL_ID, 'Report a Bug'));
      return;
    }
    if (command === 'feature') {
      response.status(200).json(reportModal(FEATURE_MODAL_ID, 'Feature Request'));
      return;
    }
    if (command === 'ask') {
      const question = getOptionValue(interaction, 'question');
      if (!question) {
        response.status(200).json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Missing `question` option.' },
        });
        return;
      }

      response
        .status(200)
        .json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
      try {
        const answer = await askProjectAi({
          question,
          apiKey: requireEnv(backendEnv.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY'),
          model: requireEnv(backendEnv.OPENROUTER_MODEL, 'OPENROUTER_MODEL'),
        });
        await editOriginalInteractionResponse(
          interaction.application_id,
          interaction.token,
          answer,
        );
      } catch (err) {
        logger.error(`discord_interactions: /ask failed: ${(err as Error).message}`);
        await editOriginalInteractionResponse(
          interaction.application_id,
          interaction.token,
          "Sorry, I couldn't get an answer — try again in a bit.",
        );
      }
      return;
    }

    response.status(200).json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `Unknown command "${command}".` },
    });
    return;
  }

  if (interaction.type === InteractionType.MODAL_SUBMIT) {
    const isBug = interaction.data?.custom_id === BUG_MODAL_ID;
    const isFeature = interaction.data?.custom_id === FEATURE_MODAL_ID;
    if (!(isBug || isFeature)) {
      response.status(200).json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Unknown form submission.' },
      });
      return;
    }

    const title = getModalValue(interaction, 'title') ?? '(no title)';
    const description = getModalValue(interaction, 'description') ?? '(no description)';

    response
      .status(200)
      .json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
    try {
      const issue = await createGithubIssueFromDiscord({
        kind: isBug ? 'bug' : 'feature',
        title,
        description,
        reporterUsername: interactionUsername(interaction),
        token: requireEnv(backendEnv.GITHUB_ISSUES_TOKEN, 'GITHUB_ISSUES_TOKEN'),
      });
      await editOriginalInteractionResponse(
        interaction.application_id,
        interaction.token,
        `✅ Created #${issue.number}: ${issue.htmlUrl}`,
      );
    } catch (err) {
      logger.error(`discord_interactions: issue creation failed: ${(err as Error).message}`);
      await editOriginalInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Sorry, I couldn't create the GitHub issue — try again in a bit.",
      );
    }
    return;
  }

  response.status(200).json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Unsupported interaction type.' },
  });
});
