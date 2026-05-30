#!/usr/bin/env bun
/**
 * Rename all source files to snake_case and update all references.
 *
 * Usage: bun run scripts/tmp/rename_to_snake_case.ts [--dry-run]
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname, basename, extname, relative, resolve } from 'path';
import { spawnSync } from 'child_process';

const DRY_RUN = process.argv.includes('--dry-run');

const TARGET_DIRS = [
  'apps/frontend/pwa',
  'apps/frontend/landing_page',
  'apps/frontend/docs',
  'apps/frontend/gamejs/src',
  'apps/frontend/gamejs/tests',
  'apps/frontend/gamejs/scripts',
  'apps/backend/firebase',
  'packages',
  'scripts',
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.svelte', '.astro'];

// Files that must never be renamed (convention, config, etc.)
const SKIP_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.test.json',
  'moon.yml',
  'biome.json',
  'biome.jsonc',
  'firestack.json',
  'firebase.json',
  'svelte.config.js',
  'svelte.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'tailwind.config.ts',
  'tailwind.config.js',
  'astro.config.mjs',
  'playwright.config.ts',
  'playwright.emulator.config.ts',
  'bunfig.toml',
  'Dockerfile',
  '.npmrc',
  'postcss.config.js',
  'project.inlang',
]);

const SKIP_PREFIXES = ['+', '.env', '.git'];

function toSnakeCase(name: string): string {
  const ext = extname(name);
  const base = basename(name, ext);

  if (/^[a-z0-9_]+$/.test(base)) return name; // Already snake_case

  let result = base
    .replace(/-/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

  // Clean up double underscores
  result = result.replace(/_+/g, '_');

  return result + ext;
}

async function findFiles(dir: string, files: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', '.svelte-kit', '.output', '.astro', '.moon', 'playwright-report', 'test-results', 'coverage', 'storybook-static', 'gen', 'templates', 'typings'].includes(entry.name)) {
        continue;
      }
      await findFiles(path, files);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (!EXTENSIONS.includes(ext)) continue;
      if (SKIP_NAMES.has(entry.name)) continue;
      if (SKIP_PREFIXES.some(p => entry.name.startsWith(p))) continue;
      files.push(path);
    }
  }
  return files;
}

async function main() {
  console.log(`🔍 Scanning for files to rename${DRY_RUN ? ' (DRY RUN)' : ''}...\n`);

  const allFiles: string[] = [];
  for (const dir of TARGET_DIRS) {
    const fullDir = resolve(dir);
    try {
      const files = await findFiles(fullDir);
      allFiles.push(...files);
    } catch (e) {
      console.warn(`⚠️  Could not scan ${dir}: ${e}`);
    }
  }

  // Compute renames
  const renames: { oldPath: string; newPath: string; oldName: string; newName: string }[] = [];
  for (const file of allFiles) {
    const dir = dirname(file);
    const name = basename(file);
    const newName = toSnakeCase(name);
    if (name !== newName) {
      renames.push({ oldPath: file, newPath: join(dir, newName), oldName: name, newName });
    }
  }

  if (renames.length === 0) {
    console.log('✅ All files already snake_case.');
    return;
  }

  console.log(`📋 Found ${renames.length} files to rename:\n`);
  for (const r of renames) {
    console.log(`   ${r.oldName} → ${r.newName}`);
  }

  if (DRY_RUN) {
    console.log('\n🏁 Dry run complete. No changes made.');
    return;
  }

  // Step 1: Rename files using git mv
  console.log('\n📝 Renaming files...\n');
  for (const r of renames) {
    spawnSync('git', ['mv', r.oldPath, r.newPath], { stdio: 'inherit' });
  }

  // Step 2: Build a map of old→new filenames for import replacement
  const importMap = new Map<string, string>();
  for (const r of renames) {
    importMap.set(r.oldName, r.newName);
  }

  // Step 3: Update imports in ALL source files (including ones that didn't change name)
  console.log('\n🔗 Updating imports...\n');
  const allSourceFiles = [...allFiles];
  // Also include files that weren't renamed but might import renamed files
  // We already scanned all target dirs, so allFiles has everything

  for (const filePath of allSourceFiles) {
    // Skip if this file was renamed (we need to use the new path)
    const actualPath = renames.find(r => r.oldPath === filePath)?.newPath || filePath;

    let content: string;
    try {
      content = await readFile(actualPath, 'utf-8');
    } catch {
      continue;
    }

    let modified = false;
    for (const [oldName, newName] of importMap) {
      // Replace imports that reference the old filename
      // Match: from './old-name', from '../old-name', from './old-name.ts', etc.
      const patterns = [
        new RegExp(`(from\\s+['"])([^'"]*${escapeRegex(oldName)})(['"])`, 'g'),
        new RegExp(`(import\\s+['"])([^'"]*${escapeRegex(oldName)})(['"])`, 'g'),
        new RegExp(`(import\\(\\s*['"])([^'"]*${escapeRegex(oldName)})(['"]\\s*\\))`, 'g'),
      ];

      for (const pattern of patterns) {
        if (pattern.test(content)) {
          content = content.replace(pattern, (_match, ...groups) => {
            const prefix = groups[0];
            const path = groups[1];
            const suffix = groups[2];
            const newPath = path.replace(new RegExp(escapeRegex(oldName) + '$'), newName);
            return `${prefix}${newPath}${suffix}`;
          });
          modified = true;
        }
      }
    }

    if (modified) {
      await writeFile(actualPath, content, 'utf-8');
      console.log(`   Updated imports in ${relative(process.cwd(), actualPath)}`);
    }
  }

  // Step 4: Update moon.yml files
  console.log('\n🌙 Updating moon.yml files...\n');
  const moonFiles: string[] = [];
  const moonDirs = [
    'apps/frontend/pwa',
    'apps/frontend/landing_page',
    'apps/frontend/docs',
    'apps/frontend/gamejs',
    'apps/backend/firebase',
    'packages/backend/ai',
    'packages/backend/auth',
    'packages/backend/configs',
    'packages/backend/database',
    'packages/backend/svelte-kit',
    'packages/backend/utils',
    'packages/frontend/components',
    'packages/frontend/configs',
    'packages/frontend/dataconnect',
    'packages/frontend/repositories',
    'packages/frontend/services',
    'packages/frontend/utils',
    'packages/shared/constants',
    'packages/shared/logger',
    'packages/shared/mocks',
    'packages/shared/schemas',
    'packages/shared/types',
    'packages/shared/utils',
    'scripts',
  ];
  for (const d of moonDirs) {
    try {
      const p = join(d, 'moon.yml');
      await readFile(p);
      moonFiles.push(p);
    } catch {
      // No moon.yml here
    }
  }
  for (const moonPath of moonFiles) {
    try {
      const content = await readFile(moonPath, 'utf-8');
      let modified = false;
      let newContent = content;
      for (const [oldName, newName] of importMap) {
        if (newContent.includes(oldName)) {
          newContent = newContent.split(oldName).join(newName);
          modified = true;
        }
      }
      if (modified) {
        await writeFile(moonPath, newContent, 'utf-8');
        console.log(`   Updated ${moonPath}`);
      }
    } catch {
      // File might not exist
    }
  }

  console.log('\n✅ Rename complete!');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch(console.error);
