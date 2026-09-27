// packages/shared/schemas/src/lib/game/prop_style.ts

import Type, { type Static } from 'typebox';

/** Authoring category used by prop audits and placement review. */
export const PropStyleClassSchema = Type.Union([
  Type.Literal('structural'),
  Type.Literal('furniture'),
  Type.Literal('clutter'),
  Type.Literal('landmark'),
  Type.Literal('vegetation'),
]);

export type PropStyleClass = Static<typeof PropStyleClassSchema>;
