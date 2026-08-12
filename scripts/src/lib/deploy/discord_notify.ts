#!/usr/bin/env bun
// scripts/src/lib/deploy/discord_notify.ts
//
// Posts a release announcement embed to Discord via a webhook, once desktop
// artifacts are live on a GitHub Release. Read-only w.r.t. the release itself
// (fetches title/notes via `gh release view`) — safe to re-run.
//
// Silently no-ops when DISCORD_WEBHOOK_URL isn't configured, so this never
// blocks a release for anyone who hasn't set up the webhook.
//
// Exported as notifyDiscordRelease() so BOTH the CI job (release.yml calls
// this file directly via `bun scripts/.../discord_notify.ts --tag=...`) AND
// a local `bun run deploy ... client-tauri` (tauri_release.ts's
// deployTauriRelease imports the function) announce the same way — CI's
// desktop matrix has its own dedicated job since it needs to wait for every
// platform leg, but a local deploy publishes straight to a release with no
// matrix to wait for, so it calls this in-process right after upload.
//
// Usage (CLI):
//   bun scripts/src/lib/deploy/discord_notify.ts --tag=v0.1.0
//   bun scripts/src/lib/deploy/discord_notify.ts --tag=v0.1.0 --mode=staging
//   env: DISCORD_WEBHOOK_URL (via scripts/.env.{mode}, loaded through
//        scripts_env.ts's initScriptsEnv — works identically in CI and local)

import { c, error, log, ok, parseCliArgs, warn } from '../cli_utils';
import { initScriptsEnv } from '../env/scripts_env';

type ReleaseInfo = { name: string; body: string; url: string };

/** Max wall-clock for the `gh release view` probe — never block a release on it. */
const GH_PROBE_TIMEOUT_MS = 15_000;
/** Max wall-clock for the Discord webhook POST. */
const WEBHOOK_TIMEOUT_MS = 10_000;

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

async function postToDiscord(options: {
  webhookUrl: string;
  tag: string;
  release: ReleaseInfo;
  downloadBase: string;
}): Promise<void> {
  const { webhookUrl, tag, release, downloadBase } = options;
  const embed = {
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
 * Announce a published release to Discord. No-ops (returns without throwing)
 * when DISCORD_WEBHOOK_URL isn't set for `mode` — safe to call unconditionally
 * after any real release upload, CI or local.
 */
export async function notifyDiscordRelease(tag: string, mode = 'production'): Promise<void> {
  initScriptsEnv(mode);

  if (!process.env.DISCORD_WEBHOOK_URL) {
    warn('DISCORD_WEBHOOK_URL not set — skipping Discord announcement.');
    return;
  }
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  const repo = process.env.GITHUB_REPOSITORY || 'BearlySleeping/aikami';
  const downloadBase = `https://github.com/${repo}/releases/latest/download`;

  log(`\n${c.bold}📣 Announcing ${tag} to Discord${c.reset}`);
  try {
    const release = await fetchRelease(tag);
    await postToDiscord({ webhookUrl, tag, release, downloadBase });
    ok(`Posted release announcement for ${tag} to Discord.`);
  } catch (err) {
    // Discord announcement is best-effort: a timeout (gh probe or webhook
    // POST) or any other failure must never fail a local deploy or leave it
    // pending. Warn and continue.
    warn(`Discord announcement skipped: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    tag: { type: 'string' },
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  });

  const tag = opts.tag ?? process.env.RELEASE_TAG ?? '';
  if (!tag) {
    error('--tag (or RELEASE_TAG) is required.');
    process.exit(1);
  }

  await notifyDiscordRelease(tag, opts.mode ?? 'production');
}

// Only run the CLI when invoked directly — notifyDiscordRelease() is also
// imported by tauri_release.ts for the local-deploy path.
if (import.meta.main) {
  await main();
}
