// packages/shared/types/src/lib/game/npc_dialogue_command.ts
//
// Re-exports from @aikami/schemas — source of truth for the NPC dialogue
// command protocol types (derived via Static<> in the schema module).
// Contract: C-328 Integrate Bounded AI NPC Dialogue with Authored Fallbacks

export type {
  NpcDialogueAiEnvelope,
  NpcDialogueChoice,
  NpcDialogueCommand,
  NpcDialogueCommandKind,
  NpcDialogueSkill,
  NpcDialogueTurn,
  NpcDialogueTurnSource,
} from '@aikami/schemas';
