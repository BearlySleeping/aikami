// apps/frontend/client/src/lib/data/npc_sprite_expressions.ts
//
// Maps NPC sprite folder names to their available expression IDs.
// Derived from file names in /static/assets/npc/{spriteName}/*.webp.
//
// To add a new sprite: create the folder and add images, then add
// the expressions here. In production, this is read from Firestore
// (the NPC document's `expressions` map).
//
// Contract: C-239 Expression Emotion System

/**
 * NPC sprite name → available expression IDs.
 * Add entries when new sprite folders or expressions are created.
 */
export const NPC_SPRITE_EXPRESSIONS: Record<string, string[]> = {
  gandalf: ['neutral', 'happy', 'sad', 'angry'],
  aragon: ['neutral', 'happy', 'sad', 'angry'],
  orc: ['neutral'],
  troll: ['neutral'],
};
