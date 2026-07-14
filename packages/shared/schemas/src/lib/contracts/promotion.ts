// packages/shared/schemas/src/lib/contracts/promotion.ts
import Type, { type Static } from 'typebox';

/**
 * Contract promotion lifecycle states.
 *
 * - `sandbox`: Feature works in a dev sandbox route only.
 * - `integrated`: Feature is wired into the production route and E2E tests pass.
 * - `release_verified`: Feature has visual tests + verified ACs, ready for release.
 */
export const PromotionStateSchema = Type.Union([
  Type.Literal('sandbox'),
  Type.Literal('integrated'),
  Type.Literal('release_verified'),
]);

export type PromotionState = Static<typeof PromotionStateSchema>;
