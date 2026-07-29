#!/usr/bin/env bun
// scripts/src/lib/ops/sync_env.ts
//
// Sync missing .env variables from one mode to another (or to .env.example).
//
// Reads a source `.env.{from}` file and copies any keys that are missing
// in the target into the target file. When the target is `example`, all
// values are stripped so only `KEY=` remains (safe for committing).
//
// Usage:
//   bun run sync-env                              # staging → .env.example
//   bun run sync-env --from=staging --to=production
//   bun run sync-env --from=staging --to=staging --dry-run
//   bun run sync-env --app=client                 # only client

import { join } from 'node:path';
import { c, fmt, parseCliArgs, parseEnvFile } from '../cli_utils';
import { liveModes, PROJECT_ENV_CONFIG } from '../deploy/deployment_config';

const ALL_APPS = Object.keys(PROJECT_ENV_CONFIG);

const resolveEnvPath = (appDir: string, mode: string): string => {
  if (mode === 'example') {
    return join(appDir, '.env.example');
  }
  return join(appDir, `.env.${mode}`);
};

const writeEnvFile = async (
  filePath: string,
  vars: Record<string, string>,
  stripValues: boolean,
): Promise<void> => {
  const file = Bun.file(filePath);
  let lines: string[] = [];
  if (await file.exists()) {
    lines = (await file.text()).split('\n');
  }

  const remaining = new Map(Object.entries(vars));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const key = line.slice(0, eqIdx).trim();
    if (remaining.has(key)) {
      const value = remaining.get(key);
      if (value === undefined) {
        continue;
      }
      lines[i] = stripValues ? `${key}=` : `${key}=${value}`;
      remaining.delete(key);
    }
  }

  for (const [key, value] of remaining) {
    lines.push(stripValues ? `${key}=` : `${key}=${value}`);
  }

  const content = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  await Bun.write(filePath, content);
};

const syncAppEnv = async (
  appDir: string,
  fromMode: string,
  toMode: string,
  dryRun: boolean,
): Promise<{ added: number; updated: number }> => {
  const fromPath = resolveEnvPath(appDir, fromMode);
  const toPath = resolveEnvPath(appDir, toMode);
  const stripValues = toMode === 'example';

  const fromFile = Bun.file(fromPath);
  if (!(await fromFile.exists())) {
    console.log(fmt.warn(`${appDir}: No .env.${fromMode} file — skipping`));
    return { added: 0, updated: 0 };
  }

  const fromVars = await parseEnvFile(fromPath);
  const toVars = await parseEnvFile(toPath);

  const missing: Record<string, string> = {};
  const updated: string[] = [];

  for (const [key, value] of Object.entries(fromVars)) {
    if (!value) {
      continue;
    }
    if (!(key in toVars)) {
      missing[key] = value;
    } else if (stripValues && toVars[key]) {
      updated.push(key);
    }
  }

  if (Object.keys(missing).length === 0 && updated.length === 0) {
    console.log(`${fmt.ok(appDir)}: all keys already present`);
    return { added: 0, updated: 0 };
  }

  const toFile = Bun.file(toPath);
  const actionVerb = (await toFile.exists()) ? 'Updated' : 'Created';

  if (!dryRun) {
    const mergedVars = { ...toVars, ...missing };
    const allVars = stripValues ? mergedVars : missing;
    await writeEnvFile(toPath, allVars, stripValues);
  }

  console.log(`${fmt.ok(appDir)}: ${actionVerb} ${toPath}${dryRun ? ' (dry-run)' : ''}`);
  for (const key of Object.keys(missing)) {
    console.log(`  ${fmt.fix(`+ ${key}`)}`);
  }
  for (const key of updated) {
    console.log(`  ${fmt.fix(`~ ${key} (stripped)`)}`);
  }

  return { added: Object.keys(missing).length, updated: updated.length };
};

// ── Main ────────────────────────────────────────────────────────────────────
const opts = parseCliArgs(Bun.argv.slice(2), {
  from: { type: 'string' },
  to: { type: 'string' },
  app: { type: 'string' },
  'dry-run': { type: 'boolean' },
});
const fromMode = (opts.from as string) ?? liveModes[0];
const toMode = (opts.to as string) ?? 'example';
const appFilter = opts.app as string | undefined;
const dryRun = opts['dry-run'] as boolean;

const apps = appFilter ? appFilter.split(',').filter((a) => ALL_APPS.includes(a)) : ALL_APPS;

if (apps.length === 0) {
  console.error(fmt.warn(`No matching apps for filter: ${appFilter}`));
  process.exit(1);
}

console.log(fmt.head('Sync .env Files'));
console.log(
  `  From: .env.${fromMode}  →  To: ${toMode === 'example' ? '.env.example' : `.env.${toMode}`}${toMode === 'example' ? ' (values stripped)' : ''}`,
);
console.log(`  Apps: ${apps.join(', ')}`);
if (dryRun) {
  console.log(`  ${c.yellow}! Dry-run — no files will be written${c.reset}`);
}
console.log();

let totalAdded = 0;
let totalUpdated = 0;

for (const app of apps) {
  const config = PROJECT_ENV_CONFIG[app];
  if (!config) {
    console.log(fmt.warn(`No config for "${app}" — skipping`));
    continue;
  }
  const appDir = config.path;
  console.log(fmt.section(app));
  const { added, updated } = await syncAppEnv(appDir, fromMode, toMode, dryRun);
  totalAdded += added;
  totalUpdated += updated;
}

console.log(fmt.head('Summary'));
console.log(
  `  ${c.green}+${totalAdded}${c.reset} keys added, ${c.cyan}~${totalUpdated}${c.reset} keys stripped`,
);
if (dryRun) {
  console.log(fmt.warn('Run without --dry-run to apply changes.'));
}
