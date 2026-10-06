// apps/frontend/client/src/lib/views/settings/ai/ai_provider_account.ts
//
// Provider-account identity for the connection editor: which stored provider
// row a draft continues, and what a new row must be created with.
//
// A stored provider is an ACCOUNT — an endpoint plus the credential that goes
// with it — not a provider type. For a fixed-origin provider the two are the
// same thing, because there is exactly one OpenRouter endpoint and the id
// names it. For a provider that takes a user-supplied URL the id is not
// unique: every unrelated API a user pastes in is `custom`. Matching those by
// id alone is what makes saving a second custom endpoint silently repoint the
// first connection at the second one's URL.
//
// Pure: no state, no services. The ViewModel applies the plan to config.

import type { AiProvider } from '@aikami/types';
import { registryLabel } from './ai_provider_registry';

/** The fields a provider account is created from. */
export type ProviderAccountFields = {
  registryId: string;
  label: string;
  credential?: string;
  baseUrl?: string;
  source: 'stored';
};

/**
 * Where a draft lands: the account it continues, or the fields to create one.
 * `existing` is the account to reuse; `create` is what to write when there is
 * none.
 */
export type ProviderAccountPlan = {
  existing: AiProvider | undefined;
  create: ProviderAccountFields;
};

/**
 * Normalizes a user-supplied endpoint for identity comparison: no trailing
 * slash, and no trailing `/v1`. Both spellings name the same OpenAI-compatible
 * root — the runtime appends `/v1` to a bare host, and the model-list URL is
 * built as `<root>/v1/models` — so treating them as different accounts would
 * hand the same server a second provider row every time the user retyped it.
 */
export const normalizeEndpoint = (baseUrl: string | undefined): string =>
  (baseUrl ?? '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');

/**
 * The stored account a draft continues.
 *
 * For a fixed-origin provider this is the registry id alone. For a provider
 * that takes a user-supplied URL the id plus the endpoint decides. An empty
 * endpoint matches nothing for an endpoint-scoped provider: a draft with no
 * URL yet is not a claim on the account some other connection happens to use.
 */
export const matchProviderAccount = (options: {
  providers: readonly AiProvider[];
  registryId: string;
  baseUrl: string | undefined;
  /** Whether this provider takes a user-supplied URL, making the id non-unique. */
  endpointScoped: boolean;
}): AiProvider | undefined => {
  const { providers, registryId, baseUrl, endpointScoped } = options;
  const candidates = providers.filter((provider) => provider.registryId === registryId);
  if (!endpointScoped) {
    return candidates[0];
  }
  const endpoint = normalizeEndpoint(baseUrl);
  if (!endpoint) {
    return undefined;
  }
  return candidates.find((provider) => normalizeEndpoint(provider.baseUrl) === endpoint);
};

/**
 * Whether a draft has left the account its connection currently points at: a
 * different provider type, or a different endpoint for a provider whose
 * accounts are endpoint-scoped.
 */
export const hasMovedAccount = (options: {
  current: AiProvider | undefined;
  registryId: string;
  baseUrl: string | undefined;
  endpointScoped: boolean;
}): boolean => {
  const { current, endpointScoped, registryId, baseUrl } = options;
  if (!current || current.registryId !== registryId) {
    return true;
  }
  return (
    endpointScoped && normalizeEndpoint(baseUrl) !== normalizeEndpoint(current.baseUrl ?? undefined)
  );
};

/**
 * Resolves the account a draft lands on, and the fields to create one when it
 * lands on none.
 */
export const planProviderAccount = (options: {
  providers: readonly AiProvider[];
  registryId: string;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  endpointScoped: boolean;
  /** Forces a fresh account — the "keep the old key, use this new one" resolution. */
  forceSeparate?: boolean;
}): ProviderAccountPlan => {
  const { apiKey, baseUrl, endpointScoped, forceSeparate, providers, registryId } = options;
  const existing = forceSeparate
    ? undefined
    : matchProviderAccount({ providers, registryId, baseUrl, endpointScoped });
  return {
    existing,
    create: {
      registryId,
      label: registryLabel(registryId) ?? registryId,
      credential: apiKey?.trim() || undefined,
      baseUrl: baseUrl?.trim() || undefined,
      source: 'stored',
    },
  };
};
