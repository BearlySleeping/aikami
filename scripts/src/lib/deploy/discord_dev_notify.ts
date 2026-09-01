#!/usr/bin/env bun
// scripts/src/lib/deploy/discord_dev_notify.ts
//
// Posts a "PR merged" embed to #merged — GitHub Actions event context
// only, no checkout needed. TASK 4 narrowed this from "every PR/issue
// open/close/reopen" down to just merges: the #pull-requests firehose
// (every PR action, opened through closed) is now handled by GitHub's own
// native Discord integration instead (see TASK 4d's setup checklist),
// which — unlike this workflow — also covers PRs from forks, since GitHub
// posts it server-side rather than through a `pull_request`-triggered
// Action run. This file only needs to post the curated "here's what
// shipped" summary to #merged, which native integration can't do (it has
// no concept of a separate merged-PR channel).
//
// TASK 4 ("one bot, one voice"): posts via scripts/src/lib/discord/post.ts's
// postToDiscord(), which relays through the worker VM so the message
// appears as AiKami Bot — this file no longer holds its own webhook URL.
//
// CI-only by design: just a step in .github/workflows/discord_dev_notify.yml
// reading the `pull_request: closed` event context GitHub Actions already
// gives it.
//
// Usage (CLI, invoked by the workflow):
//   bun scripts/src/lib/deploy/discord_dev_notify.ts
//   env: GH_NUMBER, GH_TITLE, GH_URL, GH_AUTHOR, GH_MERGE_COMMIT_URL,
//        GH_FILES_CHANGED, GH_ADDITIONS, GH_DELETIONS, WORKER_NOTIFY_SECRET

import type { APIEmbed } from 'discord-api-types/v10';
import { c, log, ok, parseCliArgs } from '../cli_utils';
import { postToDiscord } from '../discord/post';
import { initScriptsEnv } from '../env/scripts_env';

/** Merged pull-request payload populated from GitHub Actions event fields. */
export type MergedPrInput = {
  number: string;
  title: string;
  url: string;
  author: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  mergeCommitUrl: string;
};

const mergedPrEmbed = (input: MergedPrInput): APIEmbed => ({
  title: `🟣 PR merged #${input.number}: ${input.title}`,
  url: input.url,
  color: 0x8250df,
  fields: [
    { name: 'Files changed', value: String(input.filesChanged), inline: true },
    { name: 'Additions', value: `+${input.additions}`, inline: true },
    { name: 'Deletions', value: `−${input.deletions}`, inline: true },
    { name: 'Merge commit', value: `[view](${input.mergeCommitUrl})` },
  ],
  footer: { text: `@${input.author}` },
  timestamp: new Date().toISOString(),
});

/**
 * Announce a merged PR to #merged. No-ops when WORKER_NOTIFY_SECRET isn't
 * set for `mode` — same safety property as notifyDiscordRelease.
 */
export const notifyMergedPr = async (options: {
  input: MergedPrInput;
  mode?: string;
}): Promise<void> => {
  const { input, mode = 'production' } = options;
  initScriptsEnv(mode);

  log(`\n${c.bold}📣 Announcing merged PR #${input.number} to Discord${c.reset}`);
  const posted = await postToDiscord({ channel: 'merged', embed: mergedPrEmbed(input), mode });
  if (posted) {
    ok(`Posted merged PR #${input.number} to Discord.`);
  }
};

const main = async (): Promise<void> => {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  });

  await notifyMergedPr({
    input: {
      number: process.env.GH_NUMBER ?? '?',
      title: process.env.GH_TITLE ?? '(untitled)',
      url: process.env.GH_URL ?? '',
      author: process.env.GH_AUTHOR ?? 'unknown',
      filesChanged: Number(process.env.GH_FILES_CHANGED ?? '0'),
      additions: Number(process.env.GH_ADDITIONS ?? '0'),
      deletions: Number(process.env.GH_DELETIONS ?? '0'),
      mergeCommitUrl: process.env.GH_MERGE_COMMIT_URL ?? '',
    },
    mode: opts.mode ?? 'production',
  });
};

if (import.meta.main) {
  await main();
}
