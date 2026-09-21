// packages/shared/constants/src/lib/hosted_providers.ts
//
// C-524: the declared vocabulary of the *optional* hosted generation
// transports — the transport ids, the operations each one actually exposes,
// the recorded terms/account scope, and the environment variable names that
// name (never carry) the credential and the adapter flag.
//
// It lives in the shared constants package because three layers read the same
// declarations: the portable core builds a quote from them, the host adapter
// maps requests from them, and the client Studio renders a provider choice
// from them. A second copy would drift and the drift would be invisible — a
// quote that names a model the adapter never dials is a fabricated capability.
//
// 🔴 No secret, token or provider response is declared here. Only the *names*
// of the environment variables a host reads, and the public capability/terms
// facts a creator needs before consenting to spend.
//
// Contract: C-524 Optional hosted asset provider comparison

/** Every hosted transport this repository can reach. */
export const HOSTED_TRANSPORT_IDS = ['pixellab', 'elevenlabs'] as const;

/** One declared hosted transport. */
export type GenerationHostedTransportId = (typeof HOSTED_TRANSPORT_IDS)[number];

/**
 * Narrows a raw string to a declared hosted transport.
 *
 * Used by the host layers that must tell a hosted *transport* apart from a
 * local *engine* — a hosted profile has no `engineId`, so this is what keeps
 * the runner from dialling one as a local engine.
 */
export const isGenerationHostedTransportId = (
  value: string | undefined,
): value is GenerationHostedTransportId =>
  value !== undefined && (HOSTED_TRANSPORT_IDS as readonly string[]).includes(value);

/** One operation a hosted transport exposes. */
export type GenerationHostedOperation = 'image' | 'rotation' | 'animation' | 'sfx' | 'music';

/**
 * What each transport actually exposes as an API.
 *
 * 🔴 Recorded from the providers' own published API documentation for the
 * pinned version. A website-only feature is deliberately absent: PixelLab's
 * rotation/animation endpoints exist, so they are listed; nothing is listed
 * that has no documented endpoint. A request for an operation a transport does
 * not declare fails early with a typed reason rather than being posted to an
 * endpoint that does not exist.
 */
export const HOSTED_TRANSPORT_OPERATIONS: Readonly<
  Record<GenerationHostedTransportId, readonly GenerationHostedOperation[]>
> = {
  pixellab: ['image', 'rotation', 'animation'],
  elevenlabs: ['sfx', 'music'],
};

/**
 * The environment variable that enables a hosted adapter on this host.
 *
 * A comma-separated list of transport ids (`pixellab,elevenlabs`). Absent or
 * empty means *no* hosted adapter is enabled: a hosted dispatch is then a
 * typed unavailability, never a silent attempt.
 */
export const HOSTED_ADAPTER_ENV_VAR = 'AIKAMI_HOSTED_ADAPTERS';

/**
 * The environment variable that holds each transport's credential.
 *
 * 🔴 This is a variable *name*, not a credential. The host reads the value at
 * dispatch time; the value never reaches a brief, a job record, a run lock, a
 * provenance record or a browser bundle. The opaque handle recorded in those
 * places is `env:<VAR>`, never the secret.
 */
export const HOSTED_CREDENTIAL_ENV_VARS: Readonly<Record<GenerationHostedTransportId, string>> = {
  pixellab: 'PIXELLAB_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
};

/**
 * The recorded terms facts for one transport.
 *
 * These are *recorded* from the provider's published terms for the pinned
 * revision; they are deliberately not derived from the presence of an API key.
 * An API key proves API access, not a licence.
 */
export type GenerationHostedTerms = {
  /** The provider's account/plan scope this record describes. */
  readonly accountScope: string;
  /** The terms revision/date the record was taken from. */
  readonly revision: string;
  readonly date: string;
  /** Whether inference (generating a candidate) is permitted. */
  readonly inference: boolean;
  /** Whether including the accepted asset in a game is permitted. */
  readonly gameInclusion: boolean;
  /**
   * Whether redistributing the asset standalone (a sound library, an asset
   * pack) is permitted. Game inclusion does not imply this.
   */
  readonly standaloneDistribution: boolean;
  /** What is still unverified, stated plainly. */
  readonly limitation: string;
};

/**
 * The recorded terms for each declared transport.
 *
 * `standaloneDistribution: false` is the conservative, honest default: an
 * accepted hosted candidate is installable in a game, but a community export
 * of it is blocked on the denied scope until a human records a wider decision.
 */
export const HOSTED_TRANSPORT_TERMS: Readonly<
  Record<GenerationHostedTransportId, GenerationHostedTerms>
> = {
  pixellab: {
    accountScope: 'PixelLab API account (paid credits)',
    revision: 'PixelLab Terms of Service / API terms (public revision)',
    date: '2026-09-13',
    inference: true,
    gameInclusion: true,
    standaloneDistribution: false,
    limitation:
      'An API key proves API access, not a redistribution licence. Standalone asset/sound-library resale is not recorded as permitted, so a community export is blocked on the denied standaloneDistribution scope.',
  },
  elevenlabs: {
    accountScope: 'ElevenLabs paid plan (API access)',
    revision: 'ElevenLabs Terms of Use / Music terms (public revision)',
    date: '2026-09-13',
    inference: true,
    gameInclusion: true,
    standaloneDistribution: false,
    limitation:
      'A paid plan permits in-game use; it does not permit redistributing the audio standalone (a sound library). Standalone distribution is recorded as denied until a human records a wider decision.',
  },
};

/**
 * The rights scope each transport's recorded terms grant.
 *
 * Returned as the three C-518/C-513 scopes so the existing publication gate
 * consumes it unchanged — the hosted path adds no second rights authority.
 */
export const hostedTermsRightsScopes = (
  transport: GenerationHostedTransportId,
): {
  readonly inference: boolean;
  readonly gameInclusion: boolean;
  readonly standaloneDistribution: boolean;
} => {
  const terms = HOSTED_TRANSPORT_TERMS[transport];
  return {
    inference: terms.inference,
    gameInclusion: terms.gameInclusion,
    standaloneDistribution: terms.standaloneDistribution,
  };
};

/**
 * The default spend ceiling for a hosted run.
 *
 * Zero. A hosted dispatch is refused until the creator states a ceiling that
 * covers the printed preflight quote; there is no automatic paid fallback.
 */
export const DEFAULT_HOSTED_BUDGET_USD = 0;
