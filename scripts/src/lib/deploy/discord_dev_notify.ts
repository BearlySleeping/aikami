#!/usr/bin/env bun
// scripts/src/lib/deploy/discord_dev_notify.ts
//
// Posts a small embed to a dev-activity Discord channel when a PR or issue
// is opened/closed. Separate from discord_notify.ts (release announcements)
// — different channel, much higher volume, so it uses its own webhook
// (DISCORD_GITHUB_FEED_WEBHOOK_URL) rather than DISCORD_RELEASES_WEBHOOK_URL, letting you
// route "someone opened a PR" noise away from the release-announcements
// channel. Silently no-ops if that webhook isn't configured, same safety
// property as discord_notify.ts.
//
// CI-only by design: no backend endpoint, no GitHub webhook to secure —
// just a step in .github/workflows/discord_dev_notify.yml reading the
// `pull_request`/`issues` event context GitHub Actions already gives it.
//
// Usage (CLI, invoked by the workflow):
//   bun scripts/src/lib/deploy/discord_dev_notify.ts --kind=pr
//   bun scripts/src/lib/deploy/discord_dev_notify.ts --kind=issue
//   env: GH_NUMBER, GH_TITLE, GH_URL, GH_AUTHOR, GH_ACTION (opened|closed|reopened),
//        GH_MERGED ('true'|'false', pr+closed only), DISCORD_GITHUB_FEED_WEBHOOK_URL

import { c, log, ok, parseCliArgs, warn } from '../cli_utils';
import { initScriptsEnv } from '../env/scripts_env';

export type ActivityKind = 'pr' | 'issue';

export type ActivityInput = {
  kind: ActivityKind;
  action: string;
  merged: boolean;
  number: string;
  title: string;
  url: string;
  author: string;
};

/** Timeout for the Discord webhook POST. */
const WEBHOOK_TIMEOUT_MS = 10_000;

function embedFor(input: ActivityInput): { title: string; color: number } {
  const { kind, action, merged } = input;
  if (kind === 'pr') {
    if (action === 'closed' && merged) {
      return { title: '🟣 PR merged', color: 0x8250df };
    }
    if (action === 'closed') {
      return { title: '🔴 PR closed', color: 0xcf222e };
    }
    if (action === 'reopened') {
      return { title: '🟢 PR reopened', color: 0x1a7f37 };
    }
    return { title: '🟢 PR opened', color: 0x1a7f37 };
  }
  if (action === 'closed') {
    return { title: '⚪ Issue closed', color: 0x8b949e };
  }
  if (action === 'reopened') {
    return { title: '🟡 Issue reopened', color: 0xd4a72c };
  }
  return { title: '🟡 Issue opened', color: 0xd4a72c };
}

async function postToDiscord(webhookUrl: string, input: ActivityInput): Promise<void> {
  const { title, color } = embedFor(input);
  const embed = {
    title: `${title} #${input.number}: ${input.title}`,
    url: input.url,
    color,
    footer: { text: `@${input.author}` },
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook POST failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Announce a PR/issue activity event to the dev-activity Discord channel.
 * No-ops (returns without throwing) when DISCORD_GITHUB_FEED_WEBHOOK_URL isn't set
 * for `mode` — same safety property as notifyDiscordRelease.
 */
export async function notifyDiscordActivity(
  input: ActivityInput,
  mode = 'production',
): Promise<void> {
  initScriptsEnv(mode);

  if (!process.env.DISCORD_GITHUB_FEED_WEBHOOK_URL) {
    warn('DISCORD_GITHUB_FEED_WEBHOOK_URL not set — skipping dev-activity announcement.');
    return;
  }

  log(
    `\n${c.bold}📣 Announcing ${input.kind} #${input.number} (${input.action}) to Discord${c.reset}`,
  );
  try {
    await postToDiscord(process.env.DISCORD_GITHUB_FEED_WEBHOOK_URL, input);
    ok(`Posted ${input.kind} activity for #${input.number} to Discord.`);
  } catch (err) {
    // Best-effort, same as discord_notify.ts — never fail the workflow over this.
    warn(`Discord dev-activity announcement skipped: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    kind: { type: 'string' },
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  });

  const kind = opts.kind as ActivityKind | undefined;
  if (kind !== 'pr' && kind !== 'issue') {
    throw new Error('--kind must be "pr" or "issue".');
  }

  await notifyDiscordActivity(
    {
      kind,
      action: process.env.GH_ACTION ?? 'opened',
      merged: process.env.GH_MERGED === 'true',
      number: process.env.GH_NUMBER ?? '?',
      title: process.env.GH_TITLE ?? '(untitled)',
      url: process.env.GH_URL ?? '',
      author: process.env.GH_AUTHOR ?? 'unknown',
    },
    opts.mode ?? 'production',
  );
}

if (import.meta.main) {
  await main();
}
