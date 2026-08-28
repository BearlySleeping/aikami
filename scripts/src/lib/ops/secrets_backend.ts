// scripts/src/lib/ops/secrets_backend.ts
/**
 * SOPS secrets backend for Aikami (C-441). Secrets are encrypted with age
 * and committed to the repo at secrets/{mode}.enc.env — see decrypt_secrets.ts
 * and encrypt_secrets.ts for the CLI surface that reads/writes them.
 *
 * 🔴 No logging path may ever print a decrypted value.
 *     Log key names and counts only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { c } from '../cli_utils';

/**
 * 🔴 Keys that must NEVER be written to a `secrets/*.enc.env` file, even
 * encrypted. Every other secret has a bounded blast radius (leak → rotate →
 * done); the Tauri updater signing key does not — an attacker holding it can
 * sign an update every installed desktop client auto-accepts, and rotating
 * afterwards does not un-compromise machines that already pulled the signed
 * payload. Public git history is permanent, so a key leaked years later
 * still signs against clients trusting today's pubkey.
 *
 * This key lives ONLY in the `TAURI_SIGNING_PRIVATE_KEY`(`_PASSWORD`)
 * GitHub Actions secrets, injected directly as step env vars — never routed
 * through the SOPS bundle. `encrypt_secrets.ts` refuses to encrypt these keys
 * for the bundle; `decrypt_secrets.ts` doesn't treat their absence
 * from the decrypted bundle as a failure.
 */
export const NEVER_ENCRYPT_KEYS = new Set([
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
]);

// ── SOPS paths ──────────────────────────────────────────────────────────

const ROOT_DIR = resolve(import.meta.dirname, '../../../..');

/** Path to the encrypted secrets file for a given mode. */
export function sopsEncPath(mode: string): string {
  return join(ROOT_DIR, 'secrets', `${mode}.enc.env`);
}

/** Path to the decrypted output .env.{mode} file for an app. */
export function sopsDecryptedPath(mode: string, appPath: string): string {
  return join(ROOT_DIR, appPath, `.env.${mode}`);
}

// ── SOPS operations ────────────────────────────────────────────────────

/**
 * Decrypt a SOPS-encrypted file and return the key-value pairs.
 * Uses `sops --decrypt` which reads the age key from:
 *   1. SOPS_AGE_KEY env var (CI)
 *   2. SOPS_AGE_KEY_FILE env var (local — the aikami-only maintainer key, see
 *      scripts/direnv/bootstrap.sh)
 *   3. ~/.config/sops/age/keys.txt (fallback default)
 *
 * 🔴 Never log the decrypted values. Log key names and counts only.
 */
export async function sopsDecrypt(mode: string): Promise<Map<string, string>> {
  const encPath = sopsEncPath(mode);

  if (!existsSync(encPath)) {
    console.error(`\n❌ No encrypted secrets file at ${encPath}`);
    console.error(
      '   Never proceed with a partially-populated .env — create it with `bun run encrypt-secrets` first.',
    );
    process.exit(1);
  }

  console.log(`   ${c.dim}Decrypting ${encPath}${c.reset}`);

  const proc = Bun.spawn({
    cmd: ['sops', '--decrypt', encPath],
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  const out = await new Response(proc.stdout).text();
  const errText = await new Response(proc.stderr).text();
  const code = await proc.exited;

  if (code !== 0) {
    const firstLine = errText.trim().split('\n')[0] ?? 'unknown error';
    console.error(`\n❌ SOPS decryption failed for ${encPath}: ${firstLine}`);
    console.error(
      '   Ensure SOPS_AGE_KEY is set (CI) or ~/.config/sops/age/keys.txt exists (local).',
    );
    console.error(
      '   The job must fail loudly — never proceed with a partially-populated .env file.',
    );
    process.exit(1);
  }

  const result = new Map<string, string>();
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    result.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }

  console.log(`   ${c.dim}Decrypted ${result.size} keys from ${encPath}${c.reset}`);
  return result;
}

/**
 * Decrypt the existing bundle for a mode, or an empty map if it doesn't
 * exist yet. Unlike sopsDecrypt(), a missing file is not an error here —
 * encrypt_secrets.ts calls this to merge into, and "nothing encrypted yet"
 * is the expected first-run state.
 */
async function decryptExistingOrEmpty(mode: string): Promise<Map<string, string>> {
  const encPath = sopsEncPath(mode);
  if (!existsSync(encPath)) {
    return new Map();
  }
  const proc = Bun.spawn({
    cmd: ['sops', '--decrypt', encPath],
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    // Can't safely merge against a bundle we can't read — fail loudly rather
    // than silently encrypting a subset and losing every other key in it.
    const errText = await new Response(proc.stderr).text();
    console.error(`\n❌ Could not read existing ${encPath} to merge into: ${errText.trim()}`);
    process.exit(1);
  }
  const result = new Map<string, string>();
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    result.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return result;
}

/**
 * Encrypt a key-value map into a SOPS-encrypted file.
 * Uses `sops --encrypt` with the configured recipients from .sops.yaml.
 *
 * 🔴 Merges onto the existing bundle rather than replacing it — the bundle
 * is ONE shared file across every app for a mode, so encrypting a value for
 * just one app (e.g. `encrypt-secrets --mode production hub`) must never
 * wipe every other app's keys out of it. A key's value is only ever
 * overwritten when the caller actually supplies a new value for it; keys
 * outside the caller's scope pass through untouched. (A genuinely removed
 * key lingers in the bundle rather than being pruned — a stale unused key
 * is a far cheaper mistake than silent data loss.)
 *
 * Only writes if the encrypted content differs from the existing file
 * (SOPS re-encryption changes the IV, producing noisy diffs — avoid
 * unnecessary re-encryption).
 */
export async function sopsEncrypt(mode: string, secrets: Map<string, string>): Promise<boolean> {
  const encPath = sopsEncPath(mode);

  const merged = await decryptExistingOrEmpty(mode);
  for (const [key, value] of secrets) {
    merged.set(key, value);
  }

  // Build the plaintext env content
  const lines: string[] = [];
  for (const [key, value] of merged) {
    lines.push(`${key}=${value}`);
  }
  lines.push('');
  const plaintext = lines.join('\n');

  console.log(
    `   ${c.dim}Encrypting ${merged.size} keys total (${secrets.size} from this run) → ${encPath}${c.reset}`,
  );

  // stdin has no path of its own, so .sops.yaml's path_regex (which matches
  // against a file path) can't select the right recipients without
  // --filename-override telling sops what path to pretend this is.
  // --input/output-type is likewise required — there's no file extension on
  // stdin for sops to infer the dotenv format from.
  const relEncPath = `secrets/${mode}.enc.env`;
  const proc = Bun.spawn({
    // The `sops encrypt` SUBCOMMAND (not the legacy `sops --encrypt` flag
    // form, which always requires a file argument) reads stdin when no
    // filename is given. --filename-override is required in that case —
    // it's the only thing telling .sops.yaml's path_regex which recipients
    // apply. An explicit /dev/stdin path is unreliable to re-open against a
    // piped fd (ENXIO), so no filename argument is passed at all.
    cmd: [
      'sops',
      'encrypt',
      '--input-type',
      'dotenv',
      '--output-type',
      'dotenv',
      '--filename-override',
      relEncPath,
    ],
    cwd: ROOT_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
    env: { ...process.env },
  });

  await proc.stdin.write(plaintext);
  await proc.stdin.end();

  const encrypted = await new Response(proc.stdout).text();
  const errText = await new Response(proc.stderr).text();
  const code = await proc.exited;

  if (code !== 0) {
    const firstLine = errText.trim().split('\n')[0] ?? 'unknown error';
    console.error(`\n❌ SOPS encryption failed: ${firstLine}`);
    process.exit(1);
  }

  // Avoid unnecessary writes — compare with existing encrypted file
  if (existsSync(encPath)) {
    const existing = readFileSync(encPath, 'utf8');
    if (existing === encrypted) {
      console.log(`   ${c.dim}Unchanged — skipping write${c.reset}`);
      return false;
    }
  }

  writeFileSync(encPath, encrypted);
  console.log(`   ${c.dim}Wrote ${encPath}${c.reset}`);
  return true;
}

/**
 * Check if the SOPS age key is available (for pre-commit validation).
 */
export function sopsKeyAvailable(): boolean {
  if (process.env.SOPS_AGE_KEY) {
    return true;
  }
  // SOPS_AGE_KEY_FILE — the aikami-only maintainer key (see
  // scripts/direnv/bootstrap.sh), kept separate from the personal default.
  if (process.env.SOPS_AGE_KEY_FILE && existsSync(process.env.SOPS_AGE_KEY_FILE)) {
    return true;
  }
  // Fall back to the global default age key file.
  const home = process.env.HOME;
  if (home) {
    const keyFile = join(home, '.config', 'sops', 'age', 'keys.txt');
    if (existsSync(keyFile)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a file looks like a SOPS-encrypted file (starts with SOPS header).
 */
export function isSopsEncrypted(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  const content = readFileSync(filePath, 'utf8');
  return content.startsWith('ENC[') || content.includes('sops');
}
