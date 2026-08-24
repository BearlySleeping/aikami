// scripts/src/lib/ops/secrets_backend.ts
/**
 * Secrets backend abstraction for Aikami.
 *
 * Supports two backends selected via `AIKAMI_SECRETS_BACKEND` env var:
 *   - "gsm"  (default): GCP Secret Manager — the legacy backend
 *   - "sops": SOPS-encrypted files committed to the repo
 *
 * The CLI interface of download_secrets.ts and upload_secrets.ts is frozen.
 * Only the storage backend changes.
 *
 * 🔴 No logging path may ever print a decrypted value.
 *     Log key names and counts only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { c } from '../cli_utils';

// ── Backend selection ───────────────────────────────────────────────────

export type SecretsBackend = 'gsm' | 'sops';

export function resolveBackend(): SecretsBackend {
  const backend = (process.env.AIKAMI_SECRETS_BACKEND ?? 'gsm').toLowerCase();
  if (backend !== 'gsm' && backend !== 'sops') {
    console.error(
      `❌ Unknown AIKAMI_SECRETS_BACKEND "${backend}". Valid: gsm, sops`,
    );
    process.exit(1);
  }
  return backend;
}

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
 *   2. ~/.config/sops/age/keys.txt (local)
 *
 * 🔴 Never log the decrypted values. Log key names and counts only.
 */
export async function sopsDecrypt(mode: string): Promise<Map<string, string>> {
  const encPath = sopsEncPath(mode);

  if (!existsSync(encPath)) {
    console.warn(`   ⚠️  No encrypted secrets file at ${encPath}`);
    return new Map();
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
    console.error('   The job must fail loudly — never proceed with a partially-populated .env file.');
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
 * Encrypt a key-value map into a SOPS-encrypted file.
 * Uses `sops --encrypt` with the configured recipients from .sops.yaml.
 *
 * Only writes if the encrypted content differs from the existing file
 * (SOPS re-encryption changes the IV, producing noisy diffs — avoid
 * unnecessary re-encryption).
 */
export async function sopsEncrypt(
  mode: string,
  secrets: Map<string, string>,
): Promise<boolean> {
  const encPath = sopsEncPath(mode);

  // Build the plaintext env content
  const lines: string[] = [];
  for (const [key, value] of secrets) {
    lines.push(`${key}=${value}`);
  }
  lines.push('');
  const plaintext = lines.join('\n');

  console.log(`   ${c.dim}Encrypting ${secrets.size} keys → ${encPath}${c.reset}`);

  const proc = Bun.spawn({
    cmd: ['sops', '--encrypt', '.sops.yaml', '/dev/stdin'],
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
  // Check for local age key file
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
