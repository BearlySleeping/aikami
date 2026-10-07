// packages/shared/schemas/src/lib/game/session_summary.ts

import Type from 'typebox';

/** Structured completion requested by the session summary task. */
export const SessionSummaryOutputSchema = Type.Object(
  {
    synopsis: Type.String({ minLength: 1 }),
    keyEvents: Type.Array(Type.String(), { minItems: 1 }),
    npcInteractions: Type.Array(
      Type.Object({
        npcName: Type.String(),
        context: Type.String(),
      }),
    ),
  },
  { additionalProperties: false },
);
