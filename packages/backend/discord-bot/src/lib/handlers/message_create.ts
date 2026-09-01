// packages/backend/discord-bot/src/lib/handlers/message_create.ts
//
// Two things happen in a #support forum thread:
//  1. A Moderator/Admin @mentions the bot with "github issue" → summarize
//     the thread and file a GitHub issue (ISSUE_TRIGGER_REGEX).
//  2. Anyone replies to one of the bot's own messages → a grounded,
//     conversational LLM reply (same idea as /ask), with recent thread
//     history for continuity.
// Everything else in the thread is ignored — this bot never speaks
// unprompted in the forum except the new-thread auto-reply
// (thread_create.ts), which stays scoped to the forum.
//
// Everywhere ELSE the bot can read (any channel it has View+Send on), a
// plain `@AiKami` mention gets a grounded askProjectAi reply — same
// per-user CHAT_REPLY_COOLDOWN_MS cooldown bucket as the forum's
// conversational reply, so a user can't dodge the limit by mixing the two.

import { logger } from '@aikami/logger';
import { toAppErrorFromUnknownError, tryReserve } from '@aikami/utils';
import type { Client, Message, ThreadChannel } from 'discord.js';
import { askProjectAi, summarizeThreadAsIssue, type ThreadMessage } from '../ai_chat';
import {
  ADMIN_ROLE_ID,
  FORUM_CHANNEL_ID,
  FORUM_TAG_LABELS,
  ISSUE_TRIGGER_REGEX,
  MODERATOR_ROLE_ID,
} from '../constants';
import { createGithubIssue } from '../github_issue';
import type { DiscordBotEnv } from '../types';

/** How far back to pull thread history for context (both the issue summary and conversational replies). */
const HISTORY_LIMIT = 30;

const ISSUE_TRIGGER_COOLDOWN_MS = 5 * 60 * 1000;
const CHAT_REPLY_COOLDOWN_MS = 10 * 1000;

async function gatherThreadMessages(
  thread: ThreadChannel,
  excludeId: string,
): Promise<ThreadMessage[]> {
  const starter = await thread.fetchStarterMessage().catch(() => null);
  const fetched = await thread.messages.fetch({ limit: HISTORY_LIMIT });
  const ordered = [...fetched.values()].reverse(); // oldest first

  const messages: ThreadMessage[] = [];
  if (starter) {
    messages.push({ author: starter.author.username, content: starter.content });
  }
  for (const m of ordered) {
    if (m.id === excludeId || m.id === starter?.id || m.author.bot) {
      continue;
    }
    messages.push({ author: m.author.username, content: m.content });
  }
  return messages;
}

async function handleIssueTrigger(
  message: Message,
  thread: ThreadChannel,
  env: DiscordBotEnv,
): Promise<void> {
  if (!tryReserve(`issue-thread:${thread.id}`, ISSUE_TRIGGER_COOLDOWN_MS)) {
    await message.reply('Already working on (or just created) an issue for this thread.');
    return;
  }

  try {
    const messages = await gatherThreadMessages(thread, message.id);
    const labels = [
      ...new Set(
        thread.appliedTags
          .map((tagId) => FORUM_TAG_LABELS[tagId])
          .filter((l): l is string => Boolean(l)),
      ),
    ];

    const summary = await summarizeThreadAsIssue({
      threadTitle: thread.name,
      messages,
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
    });

    const issue = await createGithubIssue({
      title: summary.title,
      body: `${summary.body}\n\n---\n_Filed from Discord thread: ${thread.url}_`,
      labels,
      token: env.GITHUB_ISSUES_TOKEN,
    });

    await message.reply(`Made a GitHub issue here: ${issue.htmlUrl}`);
  } catch (err) {
    logger.error(`discord-bot/message_create: issue creation failed: ${(err as Error).message}`);
    await message.reply("Sorry, I couldn't create the GitHub issue — try again in a bit.");
  }
}

async function handleConversationalReply(
  message: Message,
  thread: ThreadChannel,
  env: DiscordBotEnv,
): Promise<void> {
  if (!tryReserve(`chat:${message.author.id}`, CHAT_REPLY_COOLDOWN_MS)) {
    return;
  }

  try {
    const history = await gatherThreadMessages(thread, message.id);
    const answer = await askProjectAi({
      question: message.content,
      history,
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
    });
    await message.reply(answer);
  } catch (err) {
    logger.error(
      `discord-bot/message_create: conversational reply failed: ${(err as Error).message}`,
    );
    await message.reply("Sorry, I couldn't get an answer — try again in a bit.");
  }
}

/** Strips every `@mention` token so the LLM sees a clean question, not raw `<@123>` markup. */
const stripMentions = (content: string): string => content.replaceAll(/<@!?\d+>/g, '').trim();

const handlePlainMentionReply = async (options: {
  message: Message;
  env: DiscordBotEnv;
}): Promise<void> => {
  const { message, env } = options;
  // Same cooldown BUCKET as the forum's conversational reply (not a
  // separate one) — a user mentioning the bot in #general right after
  // replying to it in a #support thread shouldn't get two free answers.
  if (!tryReserve(`chat:${message.author.id}`, CHAT_REPLY_COOLDOWN_MS)) {
    return;
  }

  try {
    const answer = await askProjectAi({
      question: stripMentions(message.content),
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
    });
    await message.reply(answer);
  } catch (error) {
    const appError = toAppErrorFromUnknownError(error);
    logger.error(`discord-bot/message_create: plain-mention reply failed: ${appError.message}`);
    await message.reply("Sorry, I couldn't get an answer — try again in a bit.");
  }
};

export async function handleMessageCreate(
  message: Message,
  client: Client,
  env: DiscordBotEnv,
): Promise<void> {
  if (message.author.bot || !message.inGuild()) {
    return;
  }
  const botId = client.user?.id;
  const channel = message.channel;

  if (channel.isThread() && channel.parentId === FORUM_CHANNEL_ID) {
    // #support forum thread — issue-trigger and conversational-reply
    // dispatch, EXACTLY as before this change.
    const thread = channel;

    if (
      botId &&
      message.mentions.users.has(botId) &&
      ISSUE_TRIGGER_REGEX.test(message.content) &&
      (message.member?.roles.cache.has(MODERATOR_ROLE_ID) ||
        message.member?.roles.cache.has(ADMIN_ROLE_ID))
    ) {
      await handleIssueTrigger(message, thread, env);
      return;
    }

    if (message.reference?.messageId) {
      const referenced = await message.fetchReference().catch(() => null);
      if (referenced && botId && referenced.author.id === botId) {
        await handleConversationalReply(message, thread, env);
      }
    }
    return;
  }

  // Anywhere else the bot can read: a plain @mention gets a grounded reply.
  if (botId && message.mentions.users.has(botId)) {
    await handlePlainMentionReply({ message, env });
  }
}
