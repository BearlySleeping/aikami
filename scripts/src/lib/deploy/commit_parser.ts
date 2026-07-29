// scripts/src/lib/deploy/commit_parser.ts
/**
 * Parses `deploy[...]` overrides from git commit messages.
 *
 * Tokens are split on commas and/or whitespace (e.g. `deploy[all force]`).
 *
 * Used by Cloud Build to enable explicit deployment targets via commit
 * message directives, bypassing `moon query projects --affected`.
 *
 * Patterns:
 *   deploy[all]              → all deployable apps
 *   deploy[client]           → single app
 *   deploy[client,site]      → multiple apps
 *   deploy[client,site force]→ multiple apps + force flag
 *   deploy[all force]        → all apps + force flag
 *
 * Standalone usage (Cloud Build inline step):
 *   bun scripts/src/lib/deploy/commit_parser.ts
 *   # Reads latest commit message, outputs JSON or empty string
 */

import { execSync } from 'node:child_process';
import { DEPLOYABLE_APPS } from './deployment_config';

export type CommitOverride = {
  targets: string[];
  force: boolean;
};

const DEPLOY_PATTERN = /deploy\[([^\]]*)\]/i;

export const parseCommitOverride = (commitMessage: string): CommitOverride | null => {
  const match = commitMessage.match(DEPLOY_PATTERN);
  if (!match) {
    return null;
  }

  const raw = match[1];
  const tokens = raw
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  const force = tokens.includes('force');
  const targetTokens = tokens.filter((token) => token !== 'force');

  if (targetTokens.includes('all')) {
    return { targets: [...DEPLOYABLE_APPS].sort(), force };
  }

  const deployableSet = new Set(DEPLOYABLE_APPS);
  const validTargets = targetTokens.filter((token) => deployableSet.has(token));

  if (validTargets.length === 0) {
    return null;
  }

  return { targets: validTargets.sort(), force };
};

if (import.meta.main) {
  try {
    const message = execSync('git log -1 --pretty=%B', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const override = parseCommitOverride(message);
    if (override) {
      process.stdout.write(JSON.stringify(override));
    }
  } catch {
    process.exitCode = 0;
  }
}
