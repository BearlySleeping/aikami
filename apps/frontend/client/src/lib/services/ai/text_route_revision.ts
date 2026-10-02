// apps/frontend/client/src/lib/services/ai/text_route_revision.ts
//
// An OPAQUE, NON-SECRET revision of the configuration a text route was
// resolved from.
//
// WHY THIS EXISTS
//
// The coalescing key already carried the resolved route — mode, provider,
// origin, model, generation params, reasoning. That is enough to tell two
// requests apart when the user edits a connection, a role or a preset. It is
// NOT enough for the one edit that most changes what a request is worth: the
// credential. Rotating an API key while leaving the provider, endpoint and
// model alone produces a byte-identical route identity, so a request arriving
// after the rotation could still join an in-flight attempt that the previous
// key is paying for — and, worse, could be counted against the old identity for
// the rest of the session.
//
// The obvious fix is to hash the key. That is the fix this module refuses to
// make, and the refusal is the whole point:
//
//   - A digest of a secret is a secret. It is stable, it is comparable, and it
//     therefore survives every boundary a secret is supposed to be kept out of:
//     coalescing keys, log lines, diagnostics buffers, a saved campaign, a
//     bug report pasted into a PR.
//   - A digest of a low-entropy secret is trivially reversible. An API key has
//     far less entropy than a password hash's author assumed, and this one is
//     never salted with anything the attacker does not have.
//   - Nothing here needs reversibility, or even a digest. Every use is
//     EQUALITY: "is this the same credential I saw a moment ago?" A value
//     that is opaque but unequal for every distinct secret answers that
//     question completely, and reveals nothing about which secret it was.
//
// So credentials are INTERNED, not hashed. A bounded in-process table maps each
// distinct credential string it has ever been shown to an ordinal
// (`cred-1`, `cred-2`, …). The ordinal goes into the revision; the secret stays
// in the table, inside this process, and is never read again except to compare.
//
// WHAT THE REVISION IS NOT
//
// Not a hash of the whole configuration either. The canonical projection names
// only NON-SECRET fields, so the revision string is safe to log, safe to put in
// a coalescing key and safe to compare across requests. It is a *marker*, not a
// fingerprint anyone should try to reverse: its only contract is "equal means
// nothing relevant changed; different means something relevant may have".
//
// A DIFFERENT VALUE IS ALWAYS THE SAFE DIRECTION. A false "same" would let a
// stale request join; a false "different" only costs one extra provider call
// and one missed dedup. Every design choice below is chosen for that asymmetry.
//
// Contract: issue #382 P1 ("Define behavior on config/credential revision
// changes"), reviewed against #418/#422.

/**
 * The subset of `ConfigState` this module reads.
 *
 * Structural rather than a hard import of `ConfigState`, for two reasons: the
 * projection is deliberately narrow (anything not named here cannot move a text
 * route, and a field that cannot move a route must not invalidate one), and a
 * narrow structural type is testable without constructing a whole vault.
 */
export type TextRouteRevisionSource = {
  readonly providers?: ReadonlyArray<{
    readonly id: string;
    readonly registryId: string;
    readonly baseUrl?: string;
    /** Present for keyless providers. Read ONLY to intern it. */
    readonly credential?: string;
  }>;
  readonly aiConnections?: ReadonlyArray<{
    readonly id: string;
    readonly providerId: string;
    readonly capability: string;
    readonly model: string;
    readonly label: string;
    readonly params: unknown;
  }>;
  readonly connections?: ReadonlyArray<{
    readonly id: string;
    readonly provider: string;
    readonly capability?: string;
    readonly model: string;
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly generationParams: unknown;
    readonly isDefault: boolean;
  }>;
  readonly roles?: Readonly<Record<string, string>>;
  readonly routing?: unknown;
  readonly defaultConnectionId?: string | null;
  readonly generationParams?: unknown;
};

/**
 * How many distinct credentials stay interned at once.
 *
 * A user has a handful of providers, so the working set is tiny and eviction
 * essentially never happens. It is bounded anyway: the table holds secret
 * material, and an unbounded table in a long-lived session is a slow leak.
 *
 * Eviction is SAFE in the expensive direction: a re-inserted credential gets a
 * fresh ordinal, so the revision changes for a configuration that did not
 * change. That costs one missed dedup and one extra provider call. The
 * alternative — keeping the table forever — costs a secret retention problem
 * to avoid a cache miss.
 */
const MAX_INTERNED_CREDENTIALS = 64;

/**
 * Interns credential values to ordinals, in process, without retaining a hash.
 *
 * Ordinals are assigned in first-seen order and are stable for as long as the
 * entry survives. Two equal credentials share an ordinal; two different ones
 * never do. That is the whole contract, and it is deliberately weaker than
 * "reversible", because nothing needs reversible.
 */
export type CredentialInterner = {
  /** The opaque ordinal for a credential, interning it on first sight. */
  token(credential: string | undefined): string;
  /** Distinct credentials currently retained. */
  readonly size: number;
  /** Forgets every interned credential. */
  clear(): void;
};

/** Creates a bounded credential interner. */
const createCredentialInterner = (limit?: number): CredentialInterner => {
  const bound = limit ?? MAX_INTERNED_CREDENTIALS;
  const table = new Map<string, string>();
  let next = 1;
  return {
    token(credential: string | undefined): string {
      // Absent and empty are the same fact — "this provider needs no key" —
      // and must not read as a rotation between two keyless providers.
      if (credential === undefined || credential.length === 0) {
        return 'cred-none';
      }
      const existing = table.get(credential);
      if (existing !== undefined) {
        return existing;
      }
      if (table.size >= bound) {
        // Cheapest correct eviction: drop everything and re-seed on next
        // sight. Ordinals are never reused: rotating back to an earlier key
        // before eviction must not alias the next newly interned credential.
        table.clear();
      }
      const token = `cred-${next}`;
      next += 1;
      table.set(credential, token);
      return token;
    },
    get size(): number {
      return table.size;
    },
    clear(): void {
      table.clear();
    },
  };
};

/**
 * Serialises a nested settings value deterministically, with sorted keys.
 *
 * Key ORDER is not semantic for generation params, routing or role assignments,
 * so two projections that differ only in ordering are the same configuration
 * and must produce the same revision.
 */
const canonical = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'z';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key.length}:${key}=${canonical(record[key])}`)
      .join(',')}}`;
  }
  return `${typeof value}:${String(value)}`;
};

/**
 * The non-secret description of everything that can move a text route.
 *
 * 🔴 Every field here is a field a user can see in Settings. `credential` and
 * `apiKey` are represented ONLY by their interned ordinals — a reader of this
 * function cannot tell which key was configured, only which one is in use
 * relative to the last time this ran. Fields that cannot move a route (labels,
 * `lastVerifiedAt`, creation timestamps) are deliberately absent, so a rename
 * in the UI does not invalidate every in-flight request in the session.
 */
const projectRouteConfiguration = (
  state: TextRouteRevisionSource,
  interner: CredentialInterner,
): string =>
  canonical({
    providers: (state.providers ?? [])
      .map((provider) => [
        provider.id,
        provider.registryId,
        provider.baseUrl ?? '',
        interner.token(provider.credential),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    aiConnections: (state.aiConnections ?? [])
      .map((connection) => [
        connection.id,
        connection.providerId,
        connection.capability,
        connection.model,
        canonical(connection.params),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    connections: (state.connections ?? [])
      .map((connection) => [
        connection.id,
        connection.provider,
        connection.capability ?? '',
        connection.model,
        connection.baseUrl ?? '',
        String(connection.isDefault),
        canonical(connection.generationParams),
        interner.token(connection.apiKey),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    roles: state.roles ?? {},
    routing: state.routing ?? {},
    defaultConnectionId: state.defaultConnectionId ?? null,
    generationParams: state.generationParams ?? {},
  });

/**
 * 32-bit FNV-1a over the canonical projection.
 *
 * Used only to SHORTEN the marker, never to authenticate it. A collision means
 * two different configurations share a revision, which costs one stale join in
 * an astronomically unlikely case — and the `epoch` component below makes even
 * that self-correcting, because the epoch is re-bumped whenever the projection
 * string itself differs, before the digest is ever consulted.
 */
const digest = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

/** A revision source, and the current revision of the configuration in it. */
export type TextRouteRevisionTracker = {
  /**
   * The current revision, recomputed from `state` on every call.
   *
   * Stable while nothing relevant changes, and different the moment something
   * does — including a credential rotation that leaves every visible field
   * identical.
   */
  current(state: TextRouteRevisionSource): string;
  /** Whether the last `current()` observed a change. Diagnostics only. */
  readonly revisionCount: number;
  /** The interner backing credential identity, for tests and teardown. */
  readonly interner: CredentialInterner;
  clear(): void;
};

/**
 * Creates a revision tracker over one configuration source.
 *
 * `credentialLimit` exists so the bounded-table behaviour can be exercised
 * deterministically; production leaves it at the module default.
 */
export const createTextRouteRevisionTracker = (
  credentialLimit?: number,
): TextRouteRevisionTracker => {
  const interner = createCredentialInterner(credentialLimit);
  let lastProjection: string | undefined;
  let token = 'cfg-0-none';
  let epoch = 0;
  return {
    interner,
    get revisionCount(): number {
      return epoch;
    },
    current(state: TextRouteRevisionSource): string {
      const projection = projectRouteConfiguration(state, interner);
      if (projection !== lastProjection) {
        lastProjection = projection;
        epoch += 1;
        // The epoch is part of the token, so two configurations that hashed
        // alike still never share a marker: the second one to be seen wins the
        // token and the first keeps a different one. Equality therefore means
        // "this exact configuration, observed again" rather than "these
        // configurations collided".
        token = `cfg-${epoch}-${digest(projection)}`;
      }
      return token;
    },
    clear(): void {
      lastProjection = undefined;
      interner.clear();
      epoch = 0;
      token = 'cfg-0-none';
    },
  };
};

/**
 * The revision used when NO configuration source is available.
 *
 * A distinct, non-empty value rather than an empty string, so a request built
 * without a configuration owner still has an identity — it just never shares
 * one with a request that had one. `undefined` in a coalescing key means
 * "unconstrained", and "unconstrained" must not be the same as "the default
 * configuration".
 */
export const UNKNOWN_ROUTE_REVISION = 'cfg-unknown';
