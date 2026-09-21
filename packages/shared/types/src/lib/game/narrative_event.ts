// packages/shared/types/src/lib/game/narrative_event.ts
//
// Re-exports from @aikami/schemas — source of truth for the committed narrative
// event record types (derived via Static<> in the schema module).
// Contract: C-491 Committed narrative event record

export type {
  CommittedNarrativeEvent,
  NarrativeEventKind,
  NarrativeEventRecord,
  NarrativeInformationKind,
} from '@aikami/schemas';
