// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `AudioTrack` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const AudioTrackRowSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  mood: Type.String({ description: "ND-5: free-form String — no mood vocabulary is defined anywhere (packages/shared/schemas/src/lib/media/music.ts uses String minLength 1). Candidate enum once a mood list exists. Indexed for GetTracksByMood." }),
  storageUrl: Type.String(),
});

export type AudioTrackRowData = Type.Static<typeof AudioTrackRowSchema>;
export type AudioTrackRow = Type.Static<typeof AudioTrackRowSchema>;