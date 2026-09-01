#!/usr/bin/env bun
// scripts/src/lib/deploy/discord_notify.ts
//
// Posts a release announcement embed to Discord, once desktop artifacts
// are live on a GitHub Release. Read-only w.r.t. the release itself
// (fetches title/notes via `gh release view`) — safe to re-run.
//
// Also supports --failure mode: posts a deploy-failure notification with
// the workflow run URL so the team knows immediately when a production
// deploy fails (see release.yml's notify-failure job) — posts to
// `channel: 'staff'`, not the public #releases channel.
//
// TASK 4 ("one bot, one voice"): both paths go through
// scripts/src/lib/discord/post.ts's postToDiscord(), which relays through
// the worker VM's /notify endpoint so the message appears as AiKami Bot —
// this file no longer holds a per-channel webhook URL. postToDiscord is
// itself best-effort (warns and returns on any failure), so this never
// blocks a release for anyone who hasn't set up WORKER_NOTIFY_SECRET.
//
// Usage (CLI):
//   bun scripts/src/lib/deploy/discord_notify.ts --tag=v0.1.0
//   bun scripts/src/lib/deploy/discord_notify.ts --tag=v0.1.0 --mode=staging
//   bun scripts/src/lib/deploy/discord_notify.ts --failure --mode=production --run-id=12345
//   env: WORKER_NOTIFY_SECRET (via scripts/.env.{mode}, loaded through
//        scripts_env.ts's initScriptsEnv — works identically in CI and local)
import type { APIEmbed } from 'discord-api-types/v10';
import { c, error, log, ok, parseCliArgs, warn } from '../cli_utils';
import { postToDiscord } from '../discord/post';
import { initScriptsEnv } from '../env/scripts_env';

type ReleaseInfo = { name: string; body: string; url: string };

/** Max wall-clock for the `gh release view` probe — never block a release on it. */
const GH_PROBE_TIMEOUT_MS = 15_000;

async function fetchRelease(tag: string): Promise<ReleaseInfo> {
  // Run `gh release view` with a hard timeout so a stalled gh process (or a
  // hung git credential prompt) can't block the release flow indefinitely.
  const proc = Bun.spawn(['gh', 'release', 'view', tag, '--json', 'name,body,url'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => proc.kill(), GH_PROBE_TIMEOUT_MS);
  try {
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`gh release view ${tag} failed: ${err.trim() || out.trim()}`);
    }
    return JSON.parse(out) as ReleaseInfo;
  } finally {
    clearTimeout(timer);
  }
}

/** Discord embed description max is 4096 chars — keep it well under that. */
function truncateNotes(notes: string, max = 500): string {
  const trimmed = notes.trim();
  if (trimmed.length === 0) {
    return 'No release notes.';
  }
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

const releaseEmbed = (options: {
  tag: string;
  release: ReleaseInfo;
  downloadBase: string;
}): APIEmbed => {
  const { tag, release, downloadBase } = options;
  return {
    title: `Aikami ${release.name || tag} released`,
    url: release.url,
    description: truncateNotes(release.body),
    color: 0x6d28d9,
    fields: [
      // Canonical asset names are lowercase (see ci_run.ts BUNDLE_GLOBS) — GitHub
      // release asset URLs are case-sensitive, so this must match exactly.
      { name: '🐧 Linux', value: `[AppImage](${downloadBase}/aikami.appimage)`, inline: true },
      { name: '🍎 macOS', value: `[.dmg](${downloadBase}/aikami.dmg)`, inline: true },
      { name: '🪟 Windows', value: `[.exe](${downloadBase}/aikami.exe)`, inline: true },
    ],
    footer: { text: 'Aikami Desktop' },
    timestamp: new Date().toISOString(),
  };
};

/**
 * Announce a published release to Discord. No-ops (returns without
 * throwing) when WORKER_NOTIFY_SECRET isn't set for `mode` — safe to call
 * unconditionally after any real release upload, CI or local.
 */
export const notifyDiscordRelease = async (options: {
  tag: string;
  mode?: string;
}): Promise<void> => {
  const { tag, mode = 'production' } = options;
  initScriptsEnv(mode);

  log(`\n${c.bold}📣 Announcing ${tag} to Discord${c.reset}`);
  try {
    const repo = process.env.GITHUB_REPOSITORY || 'BearlySleeping/aikami';
    const downloadBase = `https://github.com/${repo}/releases/latest/download`;
    const release = await fetchRelease(tag);
    const posted = await postToDiscord({
      channel: 'releases',
      embed: releaseEmbed({ tag, release, downloadBase }),
      roleMention: 'releasePings',
      mode,
    });
    if (posted) {
      ok(`Posted release announcement for ${tag} to Discord.`);
    }
  } catch (err) {
    // Discord announcement is best-effort: a timeout on the gh probe (or
    // any other failure) must never fail a local deploy or leave it
    // pending. Warn and continue. postToDiscord itself is ALSO
    // best-effort — this catch is for fetchRelease's gh call.
    warn(`Discord announcement skipped: ${(err as Error).message}`);
  }
};

/**
 * Post a deploy-failure notification to Discord. Used by release.yml's
 * notify-failure job (if: failure()). Posts to `channel: 'staff'` — a
 * deploy failure is internal ops noise, not something the public
 * #releases channel should see.
 */
export const notifyDiscordFailure = async (options: {
  mode: string;
  runId: string;
}): Promise<void> => {
  const { mode, runId } = options;
  initScriptsEnv(mode);

  const repo = process.env.GITHUB_REPOSITORY || 'BearlySleeping/aikami';
  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;

  const embed: APIEmbed = {
    title: `❌ Deploy failed (${mode})`,
    url: runUrl,
    description: `Workflow run [#${runId}](${runUrl}) failed. Check the Actions tab for details.`,
    color: 0xdc2626,
    footer: { text: 'Aikami Deploy' },
    timestamp: new Date().toISOString(),
  };

  const posted = await postToDiscord({ channel: 'staff', embed, mode });
  if (posted) {
    ok(`Posted deploy failure notification for ${mode} to Discord.`);
  }
};

const main = async (): Promise<void> => {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    tag: { type: 'string' },
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    failure: { type: 'boolean' },
    'run-id': { type: 'string' },
  });

  if (opts.failure) {
    const mode = opts.mode ?? 'production';
    const runId = opts['run-id'] ?? process.env.RUN_ID ?? '';
    if (!runId) {
      error('--run-id (or RUN_ID) is required for failure notifications.');
      process.exit(1);
    }
    await notifyDiscordFailure({ mode, runId });
    return;
  }

  const tag = opts.tag ?? process.env.RELEASE_TAG ?? '';
  if (!tag) {
    error('--tag (or RELEASE_TAG) is required.');
    process.exit(1);
  }

  await notifyDiscordRelease({ tag, mode: opts.mode ?? 'production' });
};

// Only run the CLI when invoked directly — notifyDiscordRelease() is also
// imported by tauri_release.ts for the local-deploy path.
if (import.meta.main) {
  await main();
}
