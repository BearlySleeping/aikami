// apps/frontend/hub/src/lib/client/services/dataconnect/persona_mapper.ts
//
// Pure row ↔ PersonaData mapping for the hub's Data Connect persona layer.
// Deliberately free of Svelte runes, Firebase imports, and DOM/Bun APIs so it
// is import-safe in both the client bundle and the Bun SSR load.
//
// PersonaRow (the SQL row as returned by ListPersonas) maps to the flat
// PersonaData character sheet:
//   - `traits` JSONB holds the sheet fields EXCEPT the top-level scalar
//     columns (id, createdAt, updatedAt, name, description, avatarUrl, uid,
//     isActive, voiceConfigId, priority) — `name` lives in its own SQL
//     column and is never duplicated inside traits.
//   - createdAt/updatedAt convert RFC 3339 → Unix epoch ms (the hub wire
//     format; the client +page.ts cast contract depends on epoch numbers).
//   - description is dropped (PersonaData has no such field).
//   - voiceConfigId is copied row.voiceConfigId → data.voiceConfigId directly
//     (a top-level PersonaData field, never inside traits).
import type { CreatePersonaVariables, UpdatePersonaVariables } from '@aikami/frontend/dataconnect';
import type { PersonaCreateData, PersonaData } from '@aikami/types';
import { toAppError } from '@aikami/utils';

/**
 * A row of the SQL `Persona` table as returned by the ListPersonas query.
 * Structural type — the generated SDK row satisfies it.
 */
export type PersonaRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  uid: string;
  traits?: unknown;
  isActive: boolean;
  voiceConfigId?: string | null;
};

/** Columns that live on the SQL row, never inside the `traits` JSONB blob. */
const ROW_SCALAR_KEYS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'name',
  'description',
  'avatarUrl',
  'uid',
  'isActive',
  'voiceConfigId',
  'priority',
]);

/** Data accepted by the repository create path: createable fields + activation state. */
export type PersonaCreateRowInput = PersonaCreateData & { isActive: boolean };

/** Data accepted by the repository update path (safe editable fields). */
export type PersonaUpdateRowInput = Omit<Partial<PersonaData>, 'uid' | 'id' | 'isActive'>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/** Extracts the sheet fields that belong inside `traits` (excludes row scalar columns). */
const serializeTraits = (data: Record<string, unknown>): Record<string, unknown> => {
  const traits: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!ROW_SCALAR_KEYS.has(key)) {
      traits[key] = value;
    }
  }
  return traits;
};

/**
 * Maps a SQL Persona row to the flat PersonaData domain shape.
 * Timestamps convert RFC 3339 → epoch ms via Date.parse.
 */
export const rowToData = (row: PersonaRow): PersonaData => {
  const sheet = isRecord(row.traits) ? serializeTraits(row.traits) : {};

  return {
    ...sheet,
    id: row.id,
    createdAt: Date.parse(row.createdAt),
    updatedAt: Date.parse(row.updatedAt),
    name: row.name,
    avatarUrl: row.avatarUrl ?? undefined,
    uid: row.uid,
    isActive: row.isActive,
    voiceConfigId: row.voiceConfigId ?? undefined,
  } as PersonaData;
};

/**
 * Serializes create data into CreatePersona variables. `name` stays in the
 * `name` column; `voiceConfigId` maps to the `voice_config_id` column; every
 * other sheet field (minus the row scalar columns) serializes into `traits`.
 * Timestamps are never sent — they are server-set on insert.
 */
export const toCreateRow = (options: {
  id: string;
  uid: string;
  data: PersonaCreateRowInput;
}): CreatePersonaVariables => {
  const { id, uid, data } = options;
  return {
    id,
    uid,
    name: data.name,
    avatarUrl: data.avatarUrl ?? null,
    voiceConfigId: data.voiceConfigId ?? null,
    traits: serializeTraits(data),
    isActive: data.isActive,
  };
};

/**
 * Serializes merged persona data into UpdatePersona variables. Same mapping
 * rules as toCreateRow, minus ownership/activation fields (unchanged by
 * updates). `updatedAt` is server-set via `updatedAt_expr: "request.time"`.
 */
export const toUpdateRow = (options: {
  uid: string;
  personaId: string;
  data: PersonaData;
}): UpdatePersonaVariables => {
  const { uid, personaId, data } = options;
  return {
    id: personaId,
    uid,
    name: data.name,
    avatarUrl: data.avatarUrl ?? null,
    voiceConfigId: data.voiceConfigId ?? null,
    traits: serializeTraits(data),
  };
};

/**
 * Merges partial update fields into the existing row's data. `undefined`
 * values are skipped so an unset field is a no-op (Firestore's update
 * semantics — a partial update never clears a field the caller did not touch).
 */
export const mergeUpdateFields = (
  existing: PersonaData,
  fields: PersonaUpdateRowInput,
): PersonaData => {
  const defined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      defined[key] = value;
    }
  }
  return { ...existing, ...defined } as PersonaData;
};

/**
 * Maps a raw Data Connect / network error into an AppError-shaped domain
 * error. The emulator returns DataConnectError (FirebaseError with a string
 * `code`) whose message carries the server-side GraphQL/Postgres detail, so
 * mapping keys off both the code and known message patterns. Pure function
 * (no logging, no env access) so it is unit-testable in isolation.
 */
export const mapDataConnectError = (operation: string, raw: unknown): Error => {
  const message = raw instanceof Error ? raw.message : String(raw);

  const code =
    raw instanceof Error && 'code' in raw && typeof (raw as { code?: unknown }).code === 'string'
      ? (raw as { code: string }).code
      : undefined;

  if (code?.includes('unauthorized') || code?.includes('unauthenticated')) {
    return toAppError({ errorType: 'unauthenticated', errorMessage: 'You are not signed in.' });
  }

  if (
    message.includes('already exists') ||
    message.includes('duplicate key') ||
    message.includes('unique constraint') ||
    message.includes('23505') ||
    message.includes('conflict')
  ) {
    return toAppError({
      errorType: 'already-exists',
      errorMessage: 'A persona with this id already exists.',
    });
  }

  if (message.includes('not found') || message.includes('No rows')) {
    return toAppError({ errorType: 'not-found', errorMessage: 'Persona not found' });
  }

  return toAppError({
    errorType: 'internal',
    errorMessage: `Persona ${operation} failed: ${message}`,
  });
};

/** True when the error already carries our AppError cause shape. */
export const isAppError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'errorType' in error.cause
  );
};
