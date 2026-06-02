/**
 * update_skills.ts — installs the official PixiJS v8 skills from
 * https://github.com/pixijs/pixijs-skills into .pi/skills-pixijs/.
 *
 * The pixijs-skills repo is shallow-cloned into a temp directory and its
 * skills/ folder is copied into the target.  Existing skills are fully
 * replaced so the update is idempotent.
 *
 * Also ensures .pi/skills-pixijs is listed in .pi/settings.json → skills[].
 */

import { $ } from "bun";
import { mkdir, rm, cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PI_DIR = join(__dirname, "..");
const TARGET = join(PI_DIR, "skills-pixijs");
const REPO_URL = "https://github.com/pixijs/pixijs-skills.git";
const SETTINGS_PATH = join(PI_DIR, "settings.json");

// ── helpers ──────────────────────────────────────────────────────────

async function sh(command: TemplateStringsArray, ...args: unknown[]) {
  const cmd = String.raw({ raw: command }, ...args);
  console.log(`  $ ${cmd}`);
  const result = await $`${{ raw: cmd }}`.quiet();
  if (result.exitCode !== 0) throw new Error(`Command failed: ${cmd}`);
  return result;
}

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  const tmp = join(PI_DIR, ".tmp-pixijs-skills");

  // 1. Clean up any leftovers
  if (existsSync(tmp)) await rm(tmp, { recursive: true });

  // 2. Shallow-clone the official repo
  console.log("Cloning pixijs-skills (shallow)...");
  await sh`git clone --depth 1 ${REPO_URL} ${tmp}`;

  // 3. Replace the target skills folder
  const src = join(tmp, "skills");
  if (!existsSync(src)) throw new Error("Repo missing skills/ directory");

  if (existsSync(TARGET)) await rm(TARGET, { recursive: true });
  await cp(src, TARGET, { recursive: true });
  console.log(`Copied skills → ${TARGET}`);

  // 4. Clean up temp clone
  await rm(tmp, { recursive: true });
  console.log("Cleaned up temp clone.");

  // 5. Ensure .pi/skills-pixijs is in settings.json
  const settingsRaw = await readFile(SETTINGS_PATH, "utf-8");
  const settings = JSON.parse(settingsRaw);

  const skillsPath = "./.pi/skills-pixijs";
  if (!settings.skills.includes(skillsPath)) {
    settings.skills.push(skillsPath);
    await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    console.log(`Added "${skillsPath}" to settings.json → skills[]`);
  } else {
    console.log(`"${skillsPath}" already in settings.json → skills[]`);
  }

  console.log("\nDone! PixiJS skills installed to .pi/skills-pixijs/");
}

main().catch((err) => {
  console.error("update_skills failed:", err);
  process.exit(1);
});
