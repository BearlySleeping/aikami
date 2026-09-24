// scripts/src/lib/agents/subagents/models.ts
//
// Model selection for subagents. Cost-first: unless the captain (or the repo
// .env) says otherwise, a subagent runs on a FREE model.
//
// Resolution for the `model` request field:
//   "provider/id"            → used verbatim (validated against pi's catalog)
//   "pro" | "flash" | "free" → the same tier env chain the contract pipeline
//                              uses (PI_MODEL_<TIER>, MODEL_<TIER>, MODEL)
//   "stealth" | undefined    → SUBAGENT_MODEL env, else the best stealth model
//                              currently in pi's catalog, else a pinned fallback
//
// Stealth models (openrouter `stealth/*`) are pre-release frontier models that
// providers offer free in exchange for telemetry. They rotate — hence
// discovery from `pi --list-models` rather than a hardcoded slug. Remember they
// log prompts: never hand one secrets.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getEnvWithFallback } from '../../cli_utils';
import { runsRoot } from './store.ts';
import type { SubagentSpec, SubagentThinking } from './types.ts';

/** Last-resort default when discovery finds nothing (still free). */
export const FALLBACK_MODEL = 'openrouter/stealth/space-bunny-alpha';

/** Preference order among discovered stealth models (substring match). */
const STEALTH_PREFERENCE = ['space-bunny'];

const CATALOG_TTL_MS = 6 * 60 * 60_000;

const TIER_KEYS: Record<'pro' | 'flash' | 'free', readonly string[]> = {
  pro: ['SUBAGENT_MODEL_PRO', 'PI_MODEL_PRO', 'MODEL_PRO', 'MODEL'],
  flash: ['SUBAGENT_MODEL_FLASH', 'PI_MODEL_FLASH', 'MODEL_FLASH', 'MODEL'],
  free: ['SUBAGENT_MODEL_FREE', 'PI_MODEL_FREE', 'MODEL_FREE'],
};

export type CatalogEntry = { provider: string; model: string; thinking: boolean };

/** Parse the table printed by `pi --list-models`. Pure — unit tested. */
export const parseModelCatalog = (text: string): CatalogEntry[] =>
  text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 6 && cols[0] !== 'provider')
    .filter((cols) => /^[a-z0-9-]+$/i.test(cols[0] ?? ''))
    .map((cols) => ({
      provider: cols[0] ?? '',
      model: cols[1] ?? '',
      thinking: cols[4] === 'yes',
    }));

/** Pick the best free stealth model from a catalog. Pure — unit tested. */
export const pickStealthModel = (catalog: CatalogEntry[]): string | undefined => {
  const stealth = catalog.filter(
    (e) => e.provider === 'openrouter' && e.model.startsWith('stealth/'),
  );
  for (const pref of STEALTH_PREFERENCE) {
    const hit = stealth.find((e) => e.model.includes(pref));
    if (hit) {
      return `${hit.provider}/${hit.model}`;
    }
  }
  const first = stealth[0];
  return first ? `${first.provider}/${first.model}` : undefined;
};

const catalogCachePath = (repoRoot: string): string =>
  join(runsRoot(repoRoot), '.model-catalog.json');

/** pi's model catalog, cached for 6h (listing costs ~1s). */
export const loadCatalog = (repoRoot: string): CatalogEntry[] => {
  const cachePath = catalogCachePath(repoRoot);
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as {
        at: number;
        entries: CatalogEntry[];
      };
      if (Date.now() - cached.at < CATALOG_TTL_MS && cached.entries.length > 0) {
        return cached.entries;
      }
    } catch {
      // Corrupt cache — rebuild below.
    }
  }
  const out = spawnSync('pi', ['--list-models'], { encoding: 'utf8', timeout: 30_000 });
  const entries = parseModelCatalog(`${out.stdout ?? ''}`);
  if (entries.length > 0) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ at: Date.now(), entries }));
  }
  return entries;
};

const inCatalog = (catalog: CatalogEntry[], model: string): boolean =>
  catalog.length === 0 || // catalog unavailable — let pi be the judge
  catalog.some((e) => `${e.provider}/${e.model}` === model || e.model === model);

export type ResolvedModel = { model: string; source: SubagentSpec['modelSource'] };

export const resolveModel = (options: {
  requested?: string;
  repoRoot: string;
  catalog?: CatalogEntry[];
}): ResolvedModel => {
  const requested = options.requested?.trim();
  const catalog = options.catalog ?? loadCatalog(options.repoRoot);

  if (requested === 'pro' || requested === 'flash' || requested === 'free') {
    const fromEnv = getEnvWithFallback(TIER_KEYS[requested]);
    if (fromEnv) {
      return { model: fromEnv, source: 'env' };
    }
    if (requested !== 'free') {
      throw new Error(
        `Model tier "${requested}" is not configured — set ${TIER_KEYS[requested].join(' / ')} in .env, or pass an explicit provider/model.`,
      );
    }
  } else if (requested && requested !== 'stealth') {
    if (!inCatalog(catalog, requested)) {
      throw new Error(
        `Unknown model "${requested}". Check \`pi --list-models ${requested.split('/').pop()}\`.`,
      );
    }
    return { model: requested, source: 'explicit' };
  }

  if (requested !== 'stealth') {
    const envDefault = getEnvWithFallback(['SUBAGENT_MODEL']);
    if (envDefault) {
      return { model: envDefault, source: 'env' };
    }
  }
  const discovered = pickStealthModel(catalog);
  if (discovered) {
    return { model: discovered, source: 'stealth-discovery' };
  }
  return { model: FALLBACK_MODEL, source: 'fallback' };
};

/** Default thinking: SUBAGENT_THINKING env, else `medium` (good cost/quality). */
export const resolveThinking = (requested?: SubagentThinking): SubagentThinking | undefined => {
  if (requested) {
    return requested;
  }
  const env = getEnvWithFallback(['SUBAGENT_THINKING']);
  return isThinking(env) ? env : 'medium';
};

const THINKING_LEVELS: readonly SubagentThinking[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

export const isThinking = (value: unknown): value is SubagentThinking =>
  typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);
