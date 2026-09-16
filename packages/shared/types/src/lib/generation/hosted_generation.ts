// packages/shared/types/src/lib/generation/hosted_generation.ts
//
// C-524: the cross-project types for the optional hosted generation path.
// Derived from the TypeBox schemas in `@aikami/schemas` — never hand-written —
// so the runtime validator and the static type cannot drift.
//
// Contract: C-524 Optional hosted asset provider comparison

import type {
  CostReservationSchema,
  HostedPreflightQuoteItemSchema,
  HostedPreflightQuoteSchema,
  HostedProviderAccountScopeSchema,
  HostedRequestEvidenceSchema,
  HostedTransportIdSchema,
  HostedUnavailabilityCodeSchema,
  HostedUnavailabilitySchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

/** A declared hosted transport id. */
export type HostedTransportId = Static<typeof HostedTransportIdSchema>;

/** One item in a preflight quote. */
export type HostedPreflightQuoteItem = Static<typeof HostedPreflightQuoteItemSchema>;

/** The preflight quote a creator consents to before a hosted dispatch. */
export type HostedPreflightQuote = Static<typeof HostedPreflightQuoteSchema>;

/** One hosted cost reservation. */
export type CostReservation = Static<typeof CostReservationSchema>;

/** One typed hosted unavailability code. */
export type HostedUnavailabilityCode = Static<typeof HostedUnavailabilityCodeSchema>;

/** A named missing precondition. */
export type HostedUnavailability = Static<typeof HostedUnavailabilitySchema>;

/** One provider account/terms record. */
export type HostedProviderAccountScope = Static<typeof HostedProviderAccountScopeSchema>;

/** One executed hosted request's evidence. */
export type HostedRequestEvidence = Static<typeof HostedRequestEvidenceSchema>;
