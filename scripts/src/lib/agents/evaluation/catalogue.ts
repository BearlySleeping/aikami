// scripts/src/lib/agents/evaluation/catalogue.ts
//
// C-480 AC-2: resolve maintainer-supplied family labels (Flash, Sonnet,
// Opus, Astra — see docs/strategy/agent-platform-hardening.md) against the
// actually-installed pi provider catalogue via `pi auth check ... --json`.
// A family label is never treated as a literal provider/model slug, and an
// unresolvable family fails preflight rather than silently substituting a
// different model.

import { spawn } from 'node:child_process';
import { getEnvWithFallback } from '../../cli_utils';
import type { CatalogueEntry, FamilyLabel } from './types.ts';

/**
 * Env fallback keys per family label — the first non-empty value wins. When
 * a family has no configured value, it yields no candidates and preflight
 * fails closed (see resolveCatalogueEntry), never silently substituting a
 * different model.
 */
const FAMILY_FALLBACK_KEYS = {
  flash: ['EVAL_MODEL_FLASH', 'PI_MODEL_FLASH', 'MODEL_FLASH', 'MODEL'],
  sonnet: ['EVAL_MODEL_SONNET', 'PI_MODEL_SONNET', 'MODEL_SONNET'],
  opus: ['EVAL_MODEL_OPUS', 'PI_MODEL_OPUS', 'MODEL_OPUS'],
  astra: ['EVAL_MODEL_ASTRA', 'PI_MODEL_ASTRA', 'MODEL_ASTRA'],
} as const satisfies Readonly<Record<FamilyLabel, readonly string[]>>;

type EnvResolver = (keys: readonly string[]) => string | undefined;

/**
 * Candidate provider/model slugs per family label, resolved from the
 * repo-root `.env`. Each family has at most one candidate — the configured
 * value — because we never hardcode model slugs.
 */
const familyCandidates = (
  envResolver: EnvResolver,
): Readonly<Record<FamilyLabel, readonly string[]>> => {
  const resolved = {} as Record<FamilyLabel, readonly string[]>;
  for (const family of Object.keys(FAMILY_FALLBACK_KEYS) as FamilyLabel[]) {
    const value = envResolver(FAMILY_FALLBACK_KEYS[family]);
    resolved[family] = value ? [value] : [];
  }
  return resolved;
};

type AuthCheckResult = { status?: string; provider?: string; reason?: string };
type AuthCheckResponse = { result: AuthCheckResult | null; diagnostics: string };
type AuthCheck = (options: { provider: string; model: string }) => Promise<AuthCheckResponse>;

const runAuthCheck = (options: { provider: string; model: string }): Promise<AuthCheckResponse> =>
  new Promise((resolve) => {
    const child = spawn(
      'pi',
      ['auth', 'check', '--provider', options.provider, '--model', options.model, '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      resolve({ result: null, diagnostics: error.message });
    });
    child.once('close', (code) => {
      const diagnostics = stderr.trim();
      if (code !== 0) {
        resolve({
          result: null,
          diagnostics: diagnostics || `pi auth check exited with code ${String(code)}.`,
        });
        return;
      }
      try {
        resolve({ result: JSON.parse(stdout.trim()) as AuthCheckResult, diagnostics });
      } catch {
        resolve({ result: null, diagnostics: diagnostics || 'Invalid JSON response.' });
      }
    });
  });

const splitSlug = (slug: string): { provider: string; model: string } => {
  const separatorIndex = slug.indexOf('/');
  if (separatorIndex < 0) {
    return { provider: slug, model: slug };
  }
  return { provider: slug.slice(0, separatorIndex), model: slug.slice(separatorIndex + 1) };
};

/**
 * Resolve one family label against the installed catalogue. Tries each
 * candidate slug in order; returns the first that `pi auth check` reports
 * as valid. Returns `available: false` with a reason when none resolve.
 */
export const resolveCatalogueEntry = async (options: {
  family: FamilyLabel;
  authCheck?: AuthCheck;
  envResolver?: EnvResolver;
}): Promise<CatalogueEntry> => {
  const { family, authCheck = runAuthCheck, envResolver = getEnvWithFallback } = options;
  const candidates = familyCandidates(envResolver)[family];
  if (candidates.length === 0) {
    return {
      family,
      provider: 'unknown',
      model: 'unknown',
      available: false,
      reason: `No candidate slugs configured for family "${family}".`,
    };
  }

  const attempted: string[] = [];
  for (const slug of candidates) {
    const { provider, model } = splitSlug(slug);
    const { result, diagnostics } = await authCheck({ provider, model });
    attempted.push(
      `${slug} (${result?.status ?? result?.reason ?? (diagnostics || 'no response')})`,
    );
    if (result?.status === 'valid') {
      return { family, provider, model, available: true };
    }
  }

  return {
    family,
    provider: 'unknown',
    model: 'unknown',
    available: false,
    reason: `No candidate resolved for family "${family}": ${attempted.join(', ')}`,
  };
};

/**
 * Resolve a set of families and report which are usable. Every family
 * fails closed — a missing model is reported, never silently swapped for
 * one that happens to work.
 */
export const preflightCatalogue = async (options: {
  families: readonly FamilyLabel[];
  authCheck?: AuthCheck;
  envResolver?: EnvResolver;
}): Promise<{ entries: readonly CatalogueEntry[]; allAvailable: boolean }> => {
  const { families, authCheck = runAuthCheck, envResolver = getEnvWithFallback } = options;
  const entries = await Promise.all(
    families.map((family) => resolveCatalogueEntry({ family, authCheck, envResolver })),
  );
  return { entries, allAvailable: entries.every((entry) => entry.available) };
};
