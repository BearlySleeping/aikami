/**
 * update_skills.ts — installs official agent skills from their upstream repos
 * into .pi/generated-skills/.
 *
 * Each repo is shallow-cloned into a temp directory, then the relevant
 * subdirectory is copied into the target.  Existing skills are fully
 * replaced so the update is idempotent.
 *
 * Also ensures each skill path is listed in .pi/settings.json → skills[].
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PI_DIR = join(__dirname, '..');
const SETTINGS_PATH = join(PI_DIR, 'settings.json');

type SkillSource = {
  /** Human-readable label for logging */
  name: string;
  /** Git repo URL (shallow-cloned) */
  repoUrl: string;
  /** Subdirectory within the cloned repo that contains the skill(s) */
  sourceSubdir: string;
  /** Target directory under .pi/generated-skills/ */
  targetSubdir: string;
  /**
   * Optional: specific files to copy from sourceSubdir (relative to sourceSubdir).
   * When omitted, the entire sourceSubdir is copied recursively.
   */
  files?: string[];
};

const SKILL_SOURCES: SkillSource[] = [
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
    sourceSubdir: '.',
    targetSubdir: 'herdr',
    files: ['SKILL.md'],
  },
  {
    name: 'Firebase',
    repoUrl: 'https://github.com/firebase/agent-skills.git',
    sourceSubdir: 'skills',
    targetSubdir: 'firebase',
  },
];

// ── helpers ──────────────────────────────────────────────────────────

async function sh(command: TemplateStringsArray, ...args: unknown[]) {
  const cmd = String.raw({ raw: command }, ...args);
  console.log(`  $ ${cmd}`);
  const result = await $`${{ raw: cmd }}`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${cmd}`);
  }
  return result;
}

// ── install one skill source ─────────────────────────────────────────

async function installSkillSource(source: SkillSource): Promise<void> {
  const target = join(PI_DIR, 'generated-skills', source.targetSubdir);
  const tmp = join(PI_DIR, `.tmp-${source.targetSubdir}-skills`);

  // 1. Clean up any leftover temp dir
  if (existsSync(tmp)) {
    await rm(tmp, { recursive: true });
  }

  // 2. Shallow-clone the repo
  console.log(`\n── ${source.name} ──`);
  console.log(`Cloning ${source.repoUrl} (shallow)...`);
  await sh`git clone --depth 1 ${source.repoUrl} ${tmp}`;

  // 3. Locate and copy the source subdirectory (or specific files)
  const src = join(tmp, source.sourceSubdir);
  if (!existsSync(src)) {
    throw new Error(`${source.name}: repo missing "${source.sourceSubdir}" directory`);
  }

  if (existsSync(target)) {
    await rm(target, { recursive: true });
  }

  if (source.files && source.files.length > 0) {
    // Copy only the specified files into the target directory
    for (const file of source.files) {
      const srcFile = join(src, file);
      const dstFile = join(target, file);
      if (!existsSync(srcFile)) {
        throw new Error(`${source.name}: repo missing file "${source.sourceSubdir}/${file}"`);
      }
      // Ensure the target subdirectory exists
      await mkdir(dirname(dstFile), { recursive: true });
      await cp(srcFile, dstFile);
      console.log(`Copied ${source.sourceSubdir}/${file} → ${dstFile}`);
    }
  } else {
    await cp(src, target, { recursive: true });
    console.log(`Copied ${source.sourceSubdir} → ${target}`);
  }

  // 4. Clean up temp clone
  await rm(tmp, { recursive: true });
  console.log('Cleaned up temp clone.');
}

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  // 1. Install each skill source
  for (const source of SKILL_SOURCES) {
    await installSkillSource(source);
  }

  // 2. Ensure the generated-skills parent path is in settings.json
  const settingsRaw = await readFile(SETTINGS_PATH, 'utf-8');
  const settings = JSON.parse(settingsRaw);

  if (!settings.skills.includes('./.pi/generated-skills')) {
    settings.skills.push('./.pi/generated-skills');
    await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
    console.log('Added "./.pi/generated-skills" to settings.json → skills[]');
  } else {
    console.log('"./.pi/generated-skills" already in settings.json → skills[]');
  }

  // 3. Register aikami-conventions skills (written by import_community_rules.ts)
  const conventionsDir = join(PI_DIR, 'skills', 'aikami-conventions');
  if (existsSync(conventionsDir)) {
    const entries = await readdir(conventionsDir, { withFileTypes: true });
    const conventionDocs = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'SKILL.md')
      .map((e) => e.name);
    if (conventionDocs.length > 0) {
      console.log(
        `\nRegistered ${conventionDocs.length} aikami-conventions doc(s): ${conventionDocs.join(', ')}`,
      );
    } else {
      console.log('\nNo aikami-conventions docs found (run import_community_rules.ts first).');
    }
  }

  // 4. Bootstrap MCP bridge registrations (C-321)
  const mcpConfigPath = join(PI_DIR, 'mcp.json');
  if (existsSync(mcpConfigPath)) {
    const mcpRaw = await readFile(mcpConfigPath, 'utf-8');
    const mcpConfig = JSON.parse(mcpRaw);
    const servers = mcpConfig.mcpServers;
    if (servers && typeof servers === 'object') {
      const serverNames = Object.keys(servers);
      console.log(
        `\nRegistered ${serverNames.length} MCP server(s) for swarm agents: ${serverNames.join(', ')}`,
      );
      for (const [name, cfg] of Object.entries(servers) as [
        string,
        { command: string; args: string[] },
      ][]) {
        console.log(`  MCP Server "${name}": ${cfg.command} ${(cfg.args ?? []).join(' ')}`);
      }
    }
  }

  const names = SKILL_SOURCES.map((s) => s.name).join(' + ');
  console.log(`\nDone! ${names} skills installed to .pi/generated-skills/`);
}

main().catch((err) => {
  console.error('update_skills failed:', err);
  process.exit(1);
});
