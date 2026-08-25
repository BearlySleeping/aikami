#!/usr/bin/env bun
// scripts/src/lib/ops/verify_bun_version.ts
//
// Asserts that the Bun version is declared identically everywhere it appears.
//
// `.bun-version` is the single source of truth: `oven-sh/setup-bun` reads it
// in CI (via `bun-version-file`), and it is what a contributor's proto/asdf
// setup detects locally. But moon needs the version in its own
// `.moon/toolchains.yml`, so the value is necessarily duplicated.
//
// A silent drift between those two is the exact failure this exists to catch:
// the runner installs one Bun, moon provisions another, and the build cache
// key stops meaning anything. Cheap to check, expensive to debug.
//
// Usage:
//   bun run scripts/src/lib/ops/verify_bun_version.ts

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const BUN_VERSION_FILE = join(ROOT_DIR, '.bun-version');
const TOOLCHAINS_FILE = join(ROOT_DIR, '.moon/toolchains.yml');

type Declaration = { source: string; version: string };

/** Read `.bun-version` — the canonical value. */
const readCanonical = (): string => {
  if (!existsSync(BUN_VERSION_FILE)) {
    console.error('❌ .bun-version is missing — it is the single source of truth for Bun.');
    process.exit(1);
  }
  const version = readFileSync(BUN_VERSION_FILE, 'utf-8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`❌ .bun-version must be an exact semver version, got "${version}".`);
    process.exit(1);
  }
  return version;
};

/**
 * Read the `version` under the top-level `bun:` key of .moon/toolchains.yml.
 * Deliberately a narrow regex rather than a YAML dependency — this runs in the
 * pre-commit hook, where startup cost is paid on every commit.
 */
const readToolchainVersion = (): string | null => {
  if (!existsSync(TOOLCHAINS_FILE)) {
    return null;
  }
  const content = readFileSync(TOOLCHAINS_FILE, 'utf-8');
  const match = content.match(
    /^bun:\s*$(?:\r?\n(?:[ \t]+.*|\s*)$)*?\r?\n[ \t]+version:\s*["']?([^"'\s#]+)/m,
  );
  return match?.[1] ?? null;
};

const canonical = readCanonical();
const declarations: Declaration[] = [{ source: '.bun-version', version: canonical }];

const toolchainVersion = readToolchainVersion();
if (toolchainVersion === null) {
  console.error('❌ Could not find `bun.version` in .moon/toolchains.yml.');
  process.exit(1);
}
declarations.push({ source: '.moon/toolchains.yml (bun.version)', version: toolchainVersion });

const drifted = declarations.filter((d) => d.version !== canonical);
if (drifted.length > 0) {
  console.error(`❌ Bun version drift — .bun-version says ${canonical}, but:`);
  for (const d of drifted) {
    console.error(`     ${d.source} says ${d.version}`);
  }
  console.error('\n   Update every location to match .bun-version.');
  process.exit(1);
}

console.log(`✅ Bun ${canonical} declared consistently in ${declarations.length} locations.`);
