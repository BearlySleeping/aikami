// scripts/src/lib/deploy/secrets.ts
/**
 * Fetch secrets from Google Secret Manager for deployment.
 *
 * Works both locally (via gcloud CLI) and in CI (via client SDK).
 * Discovers keys from .env.example and resolves them via the app prefix.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSecretName } from './deployment_config';
import { discoverSecretKeys, parseEnvKeys, run } from './utils';

// ── Types ────────────────────────────────────────────────────────────────

export type SecretEntry = {
  key: string;
  value: string;
};

// ── Core ─────────────────────────────────────────────────────────────────

/**
 * Fetches secrets from GSM for a single app, reading .env.example to
 * discover which keys are needed.
 */
export async function fetchSecrets(
  appPath: string,
  appPrefix: string | undefined,
  projectId: string,
): Promise<SecretEntry[]> {
  const baseKeys = discoverSecretKeys(appPath);
  if (baseKeys.length === 0) {
    return [];
  }

  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  const client = new SecretManagerServiceClient();
  const results: SecretEntry[] = [];
  const missing: string[] = [];

  const promises = baseKeys.map(async (key) => {
    const secretName = resolveSecretName(key, { prefix: appPrefix });
    try {
      const [version] = await client.accessSecretVersion({
        name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
      });
      const value = version.payload?.data?.toString();
      if (value !== undefined) {
        results.push({ key, value });
      } else {
        missing.push(secretName);
      }
    } catch {
      missing.push(secretName);
    }
  });

  await Promise.all(promises);

  if (missing.length > 0) {
    console.warn(`⚠️ Missing secrets (${projectId}):\n${missing.map((s) => `  - ${s}`).join('\n')}`);
  }

  return results;
}

/**
 * Build --set-secrets argument for gcloud run deploy.
 * Each secret is mapped as: ENV_KEY=secretName:latest
 */
export function buildGcloudSecretArgs(secrets: SecretEntry[], appPrefix?: string): string {
  if (secrets.length === 0) {
    return '';
  }
  const mappings = secrets.map(({ key }) => {
    const secretName = resolveSecretName(key, { prefix: appPrefix });
    return `${key}=${secretName}:latest`;
  });
  return `--set-secrets=${mappings.join(',')}`;
}

// ── Local Entry Point (called from deploy/index.ts) ──────────────────────

/**
 * Local mode: fetches secrets and returns a gcloud --set-secrets string.
 * Falls back to gcloud CLI if the client SDK is unavailable.
 */
export async function fetchAndBuildSecretArgs(
  appPath: string,
  appPrefix: string | undefined,
  projectId: string,
): Promise<string> {
  try {
    const secrets = await fetchSecrets(appPath, appPrefix, projectId);
    return buildGcloudSecretArgs(secrets, appPrefix);
  } catch (err) {
    console.warn(`⚠️ GSM SDK unavailable, trying gcloud CLI fallback... (${err})`);
    return fallbackGcloudSecrets(appPath, appPrefix, projectId);
  }
}

/**
 * Fallback: use gcloud CLI to fetch secrets when the client SDK is not available.
 */
async function fallbackGcloudSecrets(
  appPath: string,
  appPrefix: string | undefined,
  projectId: string,
): Promise<string> {
  const baseKeys = discoverSecretKeys(appPath);
  if (baseKeys.length === 0) {
    return '';
  }

  const mappings: string[] = [];
  for (const key of baseKeys) {
    const secretName = resolveSecretName(key, { prefix: appPrefix });
    try {
      const value = run(
        `gcloud secrets versions access latest --secret="${secretName}" --project="${projectId}" --quiet`,
        { quiet: true },
      );
      if (value) {
        mappings.push(`${key}=${secretName}:latest`);
        console.log(`  ✓ ${key} ← ${secretName}`);
      }
    } catch {
      console.warn(`  ⚠ ${secretName} not found`);
    }
  }

  return mappings.length > 0 ? `--set-secrets=${mappings.join(',')}` : '';
}

/**
 * Build --set-secrets from .env.{mode} file keys.
 *
 * Unlike fetchAndBuildSecretArgs, this does NOT fetch secret values from GSM.
 * It reads the app's .env.{mode} file (populated by download_secrets.ts in CI
 * or direnv locally), discovers which keys are GSM-backed secrets, and builds
 * the --set-secrets=KEY=gsmName:latest mapping so Cloud Run fetches securely
 * at cold-start time.
 *
 * Falls back to fetchAndBuildSecretArgs (direct GSM fetch) if .env.{mode}
 * doesn't exist.
 */
export async function buildSecretArgsFromEnvFile(
  appPath: string,
  appPrefix: string | undefined,
  mode: string,
  projectId: string,
): Promise<string> {
  const envPath = join(appPath, `.env.${mode}`);

  if (existsSync(envPath)) {
    const allVars = parseEnvKeys(envPath);
    const mappings: string[] = [];

    for (const key of Object.keys(allVars)) {
      // Skip PUBLIC_ keys (build-time only, compiled into bundles)
      // Skip FIREBASE_SERVICE_ACCOUNT (handled separately)
      // Skip keys with empty values — secret doesn't exist in GSM
      if (key.startsWith('PUBLIC_') || key === 'FIREBASE_SERVICE_ACCOUNT' || !allVars[key]) {
        continue;
      }
      const gsmName = resolveSecretName(key, { prefix: appPrefix });
      mappings.push(`${key}=${gsmName}:latest`);
    }

    if (mappings.length > 0) {
      console.log(
        `  ✓ Built --set-secrets from .env.${mode} (${mappings.length} secrets, no GSM fetch)`,
      );
      return `--set-secrets=${mappings.join(',')}`;
    }
    return '';
  }

  // Fallback: .env.{mode} doesn't exist → fetch from GSM directly
  console.warn(`  ⚠️  .env.${mode} not found at ${envPath} — falling back to direct GSM fetch`);
  return fetchAndBuildSecretArgs(appPath, appPrefix, projectId);
}
