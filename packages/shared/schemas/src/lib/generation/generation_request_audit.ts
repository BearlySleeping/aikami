// packages/shared/schemas/src/lib/generation/generation_request_audit.ts
//
// C-517: the request audit that travels with a generation result.
//
// It keeps three kinds of parameter strictly apart:
//
//   requested* — what the author asked for (the compiled request, ground truth)
//   effective* — what was actually submitted to the engine (a native control or
//                an explicit prompt hint), reported by the engine itself
//   measured*  — what the engine observed about its own output
//
// `measured*` is present ONLY when the engine reported the value. Echoing a
// request as though it were a measurement is the dishonesty this schema exists
// to prevent. ACE-Step v1 has no native BPM/key control, so those values ride
// along as prompt hints and are reported as `effective*`, never `measured*`.
//
// Contract: C-517 Generation request and format correctness

import { type Static, Type } from 'typebox';
import { GenerationEngineIdSchema, GenerationModalitySchema } from './asset_recipe.ts';

export const GenerationRequestAuditSchema = Type.Object({
  engine: GenerationEngineIdSchema,
  modality: GenerationModalitySchema,
  /** The compiled request prompt (recipe template + author subject). */
  subject: Type.String({ minLength: 1 }),
  /** Style/structure tags the compiled request carried, when any were set. */
  tags: Type.Optional(Type.String()),
  /** The exact prompt string the engine submitted, when it reports one. */
  effectivePrompt: Type.Optional(Type.String({ minLength: 1 })),
  requestedBpm: Type.Optional(Type.Number()),
  /** Present only when the BPM reached the engine (natively or as a hint). */
  effectiveBpm: Type.Optional(Type.Number()),
  requestedKey: Type.Optional(Type.String()),
  /** Present only when the key reached the engine (natively or as a hint). */
  effectiveKey: Type.Optional(Type.String()),
  requestedInstrumental: Type.Optional(Type.Boolean()),
  /** Present only when the instrumental decision reached the engine. */
  effectiveInstrumental: Type.Optional(Type.Boolean()),
  /** Present only when the engine reported a measured tempo. */
  measuredBpm: Type.Optional(Type.Number()),
  /** Present only when the engine reported a measured key. */
  measuredKey: Type.Optional(Type.String()),
  /** Present only when the engine reported a measured duration. */
  measuredDurationSeconds: Type.Optional(Type.Number()),
});

export type GenerationRequestAudit = Static<typeof GenerationRequestAuditSchema>;
