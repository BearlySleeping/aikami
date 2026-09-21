// apps/backend/local-stack/stack/generation/hosted/hosted_credentials.ts
//
// C-524: credential and adapter-flag resolution for the hosted transports.
//
// 🔴 The credential *value* is read here and handed to the transport for the
// duration of one request. It is never returned to a caller that records
// anything: what crosses into a job record, a run lock, a provenance record or
// a browser bundle is the opaque *reference* (`env:PIXELLAB_API_KEY`).
//
// The adapter flag is deliberately separate from the credential. A host can
// hold a key and still have the adapter switched off; the refusal then names
// the flag, not the key, so the operator knows which knob to turn.
//
// Contract: C-524 Optional hosted asset provider comparison

import {
  type GenerationHostedTransportId,
  HOSTED_ADAPTER_ENV_VAR,
  HOSTED_CREDENTIAL_ENV_VARS,
  HOSTED_TRANSPORT_IDS,
  isGenerationHostedTransportId,
} from '@aikami/constants';

/** The environment a host resolves its hosted configuration from. */
export type HostedEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The transports the host has explicitly enabled.
 *
 * `AIKAMI_HOSTED_ADAPTERS=pixellab,elevenlabs`. An absent, empty or
 * unrecognised value enables nothing — the safe default, because enabling a
 * paid transport is a deliberate act.
 */
export const resolveEnabledHostedTransports = (
  env: HostedEnvironment,
): readonly GenerationHostedTransportId[] => {
  const raw = env[HOSTED_ADAPTER_ENV_VAR]?.trim();
  if (raw === undefined || raw.length === 0) {
    return [];
  }
  const declared = new Set<string>(HOSTED_TRANSPORT_IDS);
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is GenerationHostedTransportId => declared.has(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index);
};

/** The result of resolving one transport's credential. */
export type HostedCredentialResolution =
  | {
      readonly state: 'resolved';
      /** 🔴 The opaque handle that may be recorded anywhere. */
      readonly reference: string;
      /** 🔴 The secret itself — passed to the transport, never recorded. */
      readonly value: string;
    }
  | {
      readonly state: 'missing';
      /** The environment variable that was absent (a name, not a secret). */
      readonly envVar: string;
    };

/** Resolves one transport's credential from the host's environment. */
export const resolveHostedCredential = (options: {
  transport: GenerationHostedTransportId;
  env: HostedEnvironment;
}): HostedCredentialResolution => {
  const envVar = HOSTED_CREDENTIAL_ENV_VARS[options.transport];
  const value = options.env[envVar]?.trim();
  if (value === undefined || value.length === 0) {
    return { state: 'missing', envVar };
  }
  return { state: 'resolved', reference: `env:${envVar}`, value };
};

/**
 * The opaque credential handle for a transport, when one resolves.
 *
 * Used by the planner, which needs the *handle* to decide whether a hosted
 * dispatch is authorized but must never see the secret.
 */
export const hostedCredentialReference = (options: {
  transport: GenerationHostedTransportId;
  env: HostedEnvironment;
}): string | undefined => {
  const resolved = resolveHostedCredential(options);
  return resolved.state === 'resolved' ? resolved.reference : undefined;
};

/** Narrows a raw string to a declared transport (re-exported for callers here). */
export const parseHostedTransportId = isGenerationHostedTransportId;
