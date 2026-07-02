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

import { $ } from "bun";
import { rm, cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PI_DIR = join(__dirname, "..");
const SETTINGS_PATH = join(PI_DIR, "settings.json");

interface SkillSource {
  /** Human-readable label for logging */
  name: string;
  /** Git repo URL (shallow-cloned) */
  repoUrl: string;
  /** Subdirectory within the cloned repo that contains the skill(s) */
  sourceSubdir: string;
  /** Target directory under .pi/generated-skills/ */
  targetSubdir: string;
}

const SKILL_SOURCES: SkillSource[] = [
  {
    name: "PixiJS",
    repoUrl: "https://github.com/pixijs/pixijs-skills.git",
    sourceSubdir: "skills",
    targetSubdir: "pixijs",
  },
  {
    name: "daisyUI",
    repoUrl: "https://github.com/saadeghi/daisyui.git",
    sourceSubdir: "skills/daisyui",
    targetSubdir: "daisyui",
  },
];

// ── helpers ──────────────────────────────────────────────────────────

async function sh(command: TemplateStringsArray, ...args: unknown[]) {
  const cmd = String.raw({ raw: command }, ...args);
  console.log(`  $ ${cmd}`);
  const result = await $`${{ raw: cmd }}`.quiet();
  if (result.exitCode !== 0) throw new Error(`Command failed: ${cmd}`);
  return result;
}

// ── install one skill source ─────────────────────────────────────────

async function installSkillSource(source: SkillSource): Promise<void> {
  const target = join(PI_DIR, "generated-skills", source.targetSubdir);
  const tmp = join(PI_DIR, `.tmp-${source.targetSubdir}-skills`);

  // 1. Clean up any leftover temp dir
  if (existsSync(tmp)) await rm(tmp, { recursive: true });

  // 2. Shallow-clone the repo
  console.log(`\n── ${source.name} ──`);
  console.log(`Cloning ${source.repoUrl} (shallow)...`);
  await sh`git clone --depth 1 ${source.repoUrl} ${tmp}`;

  // 3. Locate and copy the source subdirectory
  const src = join(tmp, source.sourceSubdir);
  if (!existsSync(src)) {
    throw new Error(
      `${source.name}: repo missing "${source.sourceSubdir}" directory`,
    );
  }

  if (existsSync(target)) await rm(target, { recursive: true });
  await cp(src, target, { recursive: true });
  console.log(`Copied ${source.sourceSubdir} → ${target}`);

  // 4. Clean up temp clone
  await rm(tmp, { recursive: true });
  console.log("Cleaned up temp clone.");
}

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  // 1. Install each skill source
  for (const source of SKILL_SOURCES) {
    await installSkillSource(source);
  }

  // 2. Ensure all skill paths are in settings.json
  const settingsRaw = await readFile(SETTINGS_PATH, "utf-8");
  const settings = JSON.parse(settingsRaw);
  let modified = false;

  for (const source of SKILL_SOURCES) {
    const skillsPath = `./.pi/generated-skills/${source.targetSubdir}`;
    if (!settings.skills.includes(skillsPath)) {
      settings.skills.push(skillsPath);
      console.log(`Added "${skillsPath}" to settings.json → skills[]`);
      modified = true;
    } else {
      console.log(`"${skillsPath}" already in settings.json → skills[]`);
    }
  }

  if (modified) {
    await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  }

  const names = SKILL_SOURCES.map((s) => s.name).join(" + ");
  console.log(`\nDone! ${names} skills installed to .pi/generated-skills/`);
}

main().catch((err) => {
  console.error("update_skills failed:", err);
  process.exit(1);
});
