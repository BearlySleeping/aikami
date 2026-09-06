// scripts/src/lib/agents/evaluation/catalogue.ts
//
// C-480 AC-2: resolve maintainer-supplied family labels (Flash, Sonnet,
// Opus, Astra — see docs/strategy/agent-platform-hardening.md) against the
// actually-installed pi provider catalogue via `pi auth check ... --json`.
// A family label is never treated as a literal provider/model slug, and an
// unresolvable family fails preflight rather than silently substituting a
// different model.

import { spawn } from 'node:child_process';
import type { CatalogueEntry, FamilyLabel } from './types.ts';

/**
 * Ordered candidate provider/model slugs per family label. The first
 * candidate `pi auth check` reports valid for is the resolved entry.
 * Override via env for installations with different provider packages —
 * see `.pi/settings.json`'s `packages` for what's actually installed here.
 */
const familyCandidates = (): Readonly<Record<FamilyLabel, readonly string[]>> => ({
  flash: [
    process.env.EVAL_MODEL_FLASH ?? '',
    'deepinfra/deepseek-ai/DeepSeek-V4-Flash',
    'deepseek/deepseek-v4-flash',
  ].filter(Boolean),
  sonnet: [process.env.EVAL_MODEL_SONNET ?? '', 'claude-bridge/claude-sonnet-5'].filter(Boolean),
  opus: [process.env.EVAL_MODEL_OPUS ?? '', 'claude-bridge/claude-opus-5'].filter(Boolean),
  astra: [process.env.EVAL_MODEL_ASTRA ?? '', 'openai/gpt-5.1'].filter(Boolean),
});

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
}): Promise<CatalogueEntry> => {
  const { family, authCheck = runAuthCheck } = options;
  const candidates = familyCandidates()[family];
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
}): Promise<{ entries: readonly CatalogueEntry[]; allAvailable: boolean }> => {
  const { families, authCheck = runAuthCheck } = options;
  const entries = await Promise.all(
    families.map((family) => resolveCatalogueEntry({ family, authCheck })),
  );
  return { entries, allAvailable: entries.every((entry) => entry.available) };
};
