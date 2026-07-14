// packages/shared/types/src/lib/database/persona.ts
//
// Re-exports from @aikami/schemas — source of truth for schema-derived types.
// Suffix retained because PersonaSchema is a Firestore document (composite of Core + BaseCharacterSheet).

export type { PersonaCreateData, PersonaData, PersonaUpdateData } from '@aikami/schemas';
