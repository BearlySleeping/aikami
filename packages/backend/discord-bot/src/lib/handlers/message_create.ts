// packages/backend/discord-bot/src/lib/handlers/message_create.ts
//
// Two things happen in a #bugs-features-requests thread:
//  1. A Moderator/Admin @mentions the bot with "github issue" → summarize
//     the thread and file a GitHub issue (ISSUE_TRIGGER_REGEX).
//  2. Anyone replies to one of the bot's own messages → a grounded,
//     conversational LLM reply (same idea as /ask), with recent thread
//     history for continuity.
// Everything else in the thread (and every message outside the forum) is
// ignored — this bot never speaks unprompted except the new-thread
// auto-reply (thread_create.ts).

import { logger } from '@aikami/logger';
import { tryReserve } from '@aikami/utils/rate_limit';
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

export async function handleMessageCreate(
  message: Message,
  client: Client,
  env: DiscordBotEnv,
): Promise<void> {
  if (message.author.bot || !message.inGuild()) {
    return;
  }
  const channel = message.channel;
  if (!channel.isThread() || channel.parentId !== FORUM_CHANNEL_ID) {
    return;
  }
  const thread = channel as ThreadChannel;

  const botId = client.user?.id;
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
}
