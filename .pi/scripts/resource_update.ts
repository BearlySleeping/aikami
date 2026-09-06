// .pi/scripts/resource_update.ts
//
// C-478 AC-3: Explicit, reviewable, failure-safe updates.
//
// Stages replacements in a temp directory, validates before swapping,
// cleans up on failure. Preserves the last working resource through
// the replacement.
//
// Usage:
//   bun run resource-update            # update all managed resources
//   bun run resource-update --dry-run  # show what would be updated
//   bun run resource-update <name>     # update a specific resource
//   bun run resource-update --help     # show usage

import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { $ } from 'bun';
import {
  GENERATED_SKILLS_DIR,
  hashDirectory,
  loadManifest,
  MANIFEST_PATH,
  PI_DIR,
  saveManifest,
} from './resource_manifest.ts';

// ── Types ────────────────────────────────────────────────────────────

type UpdateResult = {
  updated: string[];
  skipped: string[];
  failed: string[];
  errors: { name: string; message: string }[];
};

// ── Constants ────────────────────────────────────────────────────────
// ── Constants ────────────────────────────────────────────────────────

const BACKUP_DIR = join(PI_DIR, '.resource-backup');

// ── Git-based skill update helpers ───────────────────────────────────

type SkillSource = {
  name: string;
  repoUrl: string;
  sourceSubdir: string;
  targetSubdir: string;
  files?: string[];
  exclude?: string[];
};

/**
 * Known git skill sources matching update_skills.ts.
 */
const GIT_SKILL_SOURCES: SkillSource[] = [
  {
    name: 'PixiJS',
    repoUrl: 'https://github.com/pixijs/pixijs-skills.git',
    sourceSubdir: 'skills',
    targetSubdir: 'pixijs',
  },
  {
    name: 'daisyUI',
    repoUrl: 'https://github.com/saadeghi/daisyui.git',
    sourceSubdir: 'skills/daisyui',
    targetSubdir: 'daisyui',
  },
  {
    name: 'Herdr',
    repoUrl: 'https://github.com/ogulcancelik/herdr.git',
    sourceSubdir: 'skills/herdr',
    targetSubdir: 'herdr',
    files: ['SKILL.md'],
  },
  {
    name: 'CodeRabbit',
    repoUrl: 'https://github.com/coderabbitai/skills.git',
    sourceSubdir: 'skills',
    targetSubdir: 'coderabbit',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Run a shell command via Bun's $, with proper error handling.
 */
const sh = async (strings: TemplateStringsArray, ...args: string[]): Promise<string> => {
  const display = String.raw({ raw: strings }, ...args);
  console.log(`  $ ${display}`);
  const result = await $(strings, ...args);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (exit ${result.exitCode ?? '?'}): ${display}`);
  }
  return result.text().trim();
};

/**
 * Safely clean a temp directory with retry for Windows EBUSY.
 */
const safeRm = async (dirPath: string): Promise<void> => {
  if (!existsSync(dirPath)) {
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(dirPath, { recursive: true });
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'EBUSY' && attempt < 4) {
        await sleep(500);
      } else {
        throw err;
      }
    }
  }
};

/**
 * Backup a directory before replacement.
 */
const backupDirectory = async (dirPath: string): Promise<string | undefined> => {
  if (!existsSync(dirPath)) {
    return undefined;
  }
  const backupName = `${relative(PI_DIR, dirPath).replace(/[/\\]/g, '_')}-${Date.now()}`;
  const backupPath = join(BACKUP_DIR, backupName);
  await mkdir(BACKUP_DIR, { recursive: true });
  await cp(dirPath, backupPath, { recursive: true });
  console.log(`  Backed up to ${backupPath}`);
  return backupPath;
};

/**
 * Stage a git-skill update in a temp directory.
 * Returns the temp path and the git revision.
 */
const stageGitSkill = async (
  source: SkillSource,
): Promise<{ tmpDir: string; revision: string }> => {
  const tmpDir = join(PI_DIR, `.tmp-${source.targetSubdir}-update`);
  await safeRm(tmpDir);

  console.log(`Cloning ${source.repoUrl} (shallow)...`);
  await sh`git clone --depth 1 ${source.repoUrl} ${tmpDir}`;

  // Get the revision hash
  const revision = await sh`git -C ${tmpDir} rev-parse HEAD`;

  const srcDir = join(tmpDir, source.sourceSubdir);
  if (!existsSync(srcDir)) {
    throw new Error(`Source subdirectory not found: ${source.sourceSubdir}`);
  }

  return { tmpDir, revision };
};

/**
 * Install staged skill content into the generated-skills target directory.
 */
const installStagedSkill = async (source: SkillSource, tmpDir: string): Promise<void> => {
  const targetDir = join(GENERATED_SKILLS_DIR, source.targetSubdir);
  const srcDir = join(tmpDir, source.sourceSubdir);

  // Remove old target
  if (existsSync(targetDir)) {
    await rm(targetDir, { recursive: true });
  }

  if (source.files && source.files.length > 0) {
    await mkdir(targetDir, { recursive: true });
    for (const file of source.files) {
      const srcFile = join(srcDir, file);
      const dstFile = join(targetDir, file);
      if (!existsSync(srcFile)) {
        throw new Error(`Required file not found: ${source.sourceSubdir}/${file}`);
      }
      await mkdir(join(targetDir, dirname(file)), { recursive: true });
      await cp(srcFile, dstFile);
    }
  } else {
    const excluded = new Set(source.exclude ?? []);
    await cp(srcDir, targetDir, {
      recursive: true,
      filter: (srcPath: string) => {
        const rel = srcPath.slice(srcDir.length).replace(/^[/\\]+/, '');
        const topLevel = rel.split(/[/\\]/)[0] ?? '';
        return !excluded.has(topLevel);
      },
    });
  }

  console.log(`  Installed ${source.targetSubdir} → ${targetDir}`);
};

// ── Update logic ─────────────────────────────────────────────────────

/**
 * Update a single git-skill resource.
 */
const updateGitSkill = async (resourceName: string, source: SkillSource): Promise<void> => {
  console.log(`\n── ${source.name} ──`);

  // 1. Backup current
  const targetDir = join(GENERATED_SKILLS_DIR, source.targetSubdir);
  const backupPath = await backupDirectory(targetDir);

  try {
    // 2. Stage in temp
    const { tmpDir, revision } = await stageGitSkill(source);

    // 3. Install
    await installStagedSkill(source, tmpDir);

    // 4. Validate installed content
    const identity = await hashDirectory(targetDir);
    if (!identity.contentHash || identity.fileCount === 0) {
      throw new Error('Installed content is empty after update');
    }

    console.log(`  Revision: ${revision.slice(0, 12)}`);
    console.log(
      `  Content hash: ${identity.contentHash.slice(0, 16)}… (${identity.fileCount} files)`,
    );

    // 5. Clean up temp
    await safeRm(tmpDir);

    // 6. Update manifest entry
    const loaded = await loadManifest();
    if (!loaded) {
      throw new Error('Failed to load manifest for update');
    }
    const manifest = loaded;
    if (manifest.resources[resourceName]) {
      manifest.resources[resourceName].installed = {
        contentHash: identity.contentHash,
        fileCount: identity.fileCount,
        recordedAt: new Date().toISOString(),
      };
      manifest.resources[resourceName].source = {
        kind: 'git',
        url: source.repoUrl,
        revision,
        subdir: source.sourceSubdir,
      };
      manifest.updatedAt = new Date().toISOString();
      await saveManifest(manifest);
      console.log('  Manifest updated.');
    }

    console.log(`  ✅ ${source.name} updated successfully.`);
  } catch (err) {
    // Failure-safe: restore backup on failure
    console.error(`  ❌ Update failed: ${(err as Error).message}`);

    if (backupPath && existsSync(backupPath)) {
      console.log('  Restoring backup...');
      if (existsSync(targetDir)) {
        await rm(targetDir, { recursive: true });
      }
      await cp(backupPath, targetDir, { recursive: true });
      console.log('  Backup restored.');
    }

    throw err;
  } finally {
    // Clean up backup if update succeeded
    if (backupPath && existsSync(backupPath)) {
      await safeRm(backupPath);
    }
  }
};

// ── Main ─────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Usage: bun run resource-update [options] [name]

Options:
  --dry-run    Show what would be updated without making changes
  --help       Show this help

Arguments:
  name         Update only the specified resource (e.g., pixijs, daisyui)

Examples:
  bun run resource-update           # update all managed resources
  bun run resource-update pixijs    # update only PixiJS skills
  bun run resource-update --dry-run # preview without changes
`);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const targetName = args.find((a) => !a.startsWith('--'));

  if (dryRun) {
    console.log('🔍 Dry-run mode — no changes will be made.\n');
    for (const source of GIT_SKILL_SOURCES) {
      if (targetName && source.targetSubdir !== targetName) {
        continue;
      }
      console.log(`  Would update: ${source.name} (${source.repoUrl})`);
    }
    console.log('\nDry-run complete. Pass no flags to apply updates.');
    process.exit(0);
  }

  console.log('=== Resource Update ===');
  console.log(`Manifest: ${MANIFEST_PATH}`);

  // Load or create manifest
  let manifest = await loadManifest();
  if (!manifest) {
    console.log('No manifest found. Creating one...');
    const { createManifest } = await import('./resource_manifest.ts');
    manifest = createManifest();
    await saveManifest(manifest);
  }

  const result: UpdateResult = { updated: [], skipped: [], failed: [], errors: [] };

  // Update git skills
  for (const source of GIT_SKILL_SOURCES) {
    if (targetName && source.targetSubdir !== targetName) {
      continue;
    }

    try {
      await updateGitSkill(source.targetSubdir, source);
      result.updated.push(source.targetSubdir);
    } catch (err) {
      result.failed.push(source.targetSubdir);
      result.errors.push({
        name: source.targetSubdir,
        message: (err as Error).message,
      });
    }
  }

  // Summary
  console.log('\n=== Update Summary ===');
  console.log(`  Updated: ${result.updated.length}`);
  console.log(`  Skipped: ${result.skipped.length}`);
  console.log(`  Failed:  ${result.failed.length}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`  ❌ ${error.name}: ${error.message}`);
    }
  }

  if (result.failed.length > 0) {
    process.exit(1);
  }
};

// Only auto-run when executed directly (not when imported as a module by tests)
const isDirectExecution = process.argv[1]?.endsWith('resource_update.ts');
if (isDirectExecution) {
  main().catch((err: Error) => {
    console.error('resource-update failed:', err.message);
    process.exit(2);
  });
}
