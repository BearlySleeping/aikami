// packages/backend/discord-bot/src/lib/handlers/thread_create.ts
//
// Auto-replies to every new post in #bugs-features-requests with a
// template reminding the user to include diagnostics and not to ping
// developers directly — same idea as the reference server's forum bot.

import { logger } from '@aikami/logger';
import type { AnyThreadChannel } from 'discord.js';
import { FORUM_CHANNEL_ID } from '../constants';

const AUTO_REPLY = [
  'Howdy!',
  '',
  'Thank you for submitting a new bug report/feature request, your support means a lot. A member of the team will look into it as soon as possible, and if they find it valid, they will open a GitHub Issue out of it. Do not ping any of the developers, this will not speed up the process.',
  '',
  'If you have diagnostics available for your setup, please include them — it helps a lot.',
  '',
  "This is an automated message, but if you reply to it, I'll do my best to help using my LLM-powered brain. That said, it's best for a human to handle anything unusual.",
  '',
  'Cheers',
].join('\n');

export async function handleThreadCreate(
  thread: AnyThreadChannel,
  newlyCreated: boolean,
): Promise<void> {
  if (!newlyCreated || thread.parentId !== FORUM_CHANNEL_ID) {
    return;
  }
  try {
    await thread.send(AUTO_REPLY);
  } catch (err) {
    logger.error(`discord-bot/thread_create: failed to send auto-reply: ${(err as Error).message}`);
  }
}
