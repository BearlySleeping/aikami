// packages/shared/types/src/lib/game/rules_command.ts
//
// Re-exports from @aikami/schemas — source of truth for the rules
// command protocol types (derived via Static<> in the schema module).
// Contract: C-336 AC-2

export type {
  CommandLogEntry,
  GeneratedLootItem,
  LootTableEntry,
  MechanicalSnapshot,
  RulesCommand,
  RulesCommandKind,
  RulesEvent,
  RulesEventKind,
} from '@aikami/schemas';
