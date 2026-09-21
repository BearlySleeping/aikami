// packages/shared/schemas/src/lib/game/actor_visual.ts
//
// How a content-pack actor draws itself.
//
// Not every actor is a humanoid. A hound, a construct or a creature has no LPC
// body/hair/torso/legs to compose, so forcing one through the LPC pipeline
// either renders the wrong thing or renders nothing.
//
// This is the smallest generic capability that lets a pack say so: an actor
// either composes LPC layers, or names ONE authored image. It is deliberately a
// discriminated union rather than an optional `staticUrl`, so "both" and
// "neither" are unrepresentable.
//
// Extracted from `content_pack.ts` rather than inlined there: that module is at
// its reviewed size ceiling, and this is an independent concept.

import { type Static, Type } from 'typebox';

/** One authored still image used as an actor's whole visual. */
export const StaticVisualSchema = Type.Object(
  {
    kind: Type.Literal('static'),
    /** Published image URL, resolved by the same content-pack base as LPC art. */
    url: Type.String({ minLength: 1 }),
    /** Natural size of the image in pixels. */
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    /**
     * Fraction of the image height that sits at the actor's feet.
     * Defaults to 1 (bottom edge), which is what a ground-standing sprite wants.
     */
    anchorY: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    /** Attribution carried through to the published credits rows. */
    credit: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type StaticVisual = Static<typeof StaticVisualSchema>;

/**
 * How an actor draws itself.
 *
 * `lpc` is the existing composed-appearance path; `static` is one authored
 * image. Absence of the field means `lpc`, so every existing pack is unchanged.
 */
export const ActorVisualSchema = Type.Union([
  Type.Object({ kind: Type.Literal('lpc') }, { additionalProperties: false }),
  StaticVisualSchema,
]);

export type ActorVisual = Static<typeof ActorVisualSchema>;
