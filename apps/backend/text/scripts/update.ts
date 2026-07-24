// apps/backend/text/scripts/update.ts
// Checks GitHub Releases for the latest Shimmy version that has
// a pre-built Linux binary, updates .shimmy-version, and optionally
// rebuilds the container image.
//
// Usage:
//   bun run update              # check + update .shimmy-version + rebuild
//   bun run update --dry-run    # check only, don't write or rebuild

import { $ } from 'bun';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');

const GITHUB_API = 'https://api.github.com/repos/Michael-A-Kuykendall/shimmy/releases';
const VERSION_FILE = resolve(PROJECT_DIR, '.shimmy-version');
const IMAGE_TAG = 'aikami-text-dev:latest';
const BINARY_NAME = 'shimmy-linux-x86_64';
const PER_PAGE = 10; // releases to check

// ── Types ──────────────────────────────────────────────────

type GitHubRelease = {
  tag_name: string;
  name: string;
  published_at: string;
  assets: Array<{ name: string }>;
};

// ── Helpers ─────────────────────────────────────────────────

/**
 * Fetch recent releases and find the latest one with a Linux binary asset.
 */
const fetchLatestVersion = async (): Promise<string | null> => {
  const response = await fetch(`${GITHUB_API}?per_page=${PER_PAGE}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'aikami-text-updater',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }

  const releases = (await response.json()) as GitHubRelease[];

  // Filter releases with a Linux binary, then pick highest semver
  const withBinary = releases.filter((r) =>
    r.assets.some((a) => a.name === BINARY_NAME),
  );

  if (withBinary.length === 0) {
    return null;
  }

  // Sort by semver descending (strip leading 'v' for comparison)
  withBinary.sort((a, b) => {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const va = parse(a.tag_name);
    const vb = parse(b.tag_name);
    for (let i = 0; i < 3; i++) {
      const diff = (vb[i] ?? 0) - (va[i] ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  });

  return withBinary[0].tag_name;
};

// ── Entry Point ─────────────────────────────────────────────

const main = async (): Promise<void> => {
  const dryRun = Bun.argv.includes('--dry-run');

  // Read current version
  const currentVersion = readFileSync(VERSION_FILE, 'utf-8').trim();
  console.log(`Current Shimmy version: ${currentVersion}`);

  // Fetch latest
  console.log('Checking GitHub Releases...');
  const latestVersion = await fetchLatestVersion();

  if (!latestVersion) {
    console.error('✗ Could not find any release with a Linux binary.');
    console.error(`  Checked last ${PER_PAGE} releases on GitHub.`);
    process.exit(1);
  }

  console.log(`Latest release:        ${latestVersion}`);

  if (latestVersion === currentVersion) {
    console.log('✓ Already up to date.');
    process.exit(0);
  }

  console.log(`\n⬆  Upgrade: ${currentVersion} → ${latestVersion}`);

  if (dryRun) {
    console.log('[dry-run] Would update .shimmy-version and rebuild.');
    process.exit(0);
  }

  // Write new version
  writeFileSync(VERSION_FILE, `${latestVersion}\n`);
  console.log(`✓ Updated .shimmy-version`);

  // Rebuild image
  console.log(`\nRebuilding image with ${latestVersion}...`);
  const buildResult =
    await $`podman build --build-arg SHIMMY_VERSION=${latestVersion} -t ${IMAGE_TAG} -f Dockerfile .`.cwd(PROJECT_DIR).nothrow();

  if (buildResult.exitCode !== 0) {
    console.error('✗ Build failed. Reverting .shimmy-version...');
    writeFileSync(VERSION_FILE, `${currentVersion}\n`);
    console.error(`  Restored ${currentVersion}`);
    process.exit(1);
  }

  console.log(`✓ Image rebuilt (${IMAGE_TAG})`);
  console.log('✅ Text service updated.');
};

main();
