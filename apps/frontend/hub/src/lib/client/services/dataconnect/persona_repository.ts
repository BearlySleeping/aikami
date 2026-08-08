// apps/frontend/hub/src/lib/client/services/dataconnect/persona_repository.ts
//
// Data Connect persona repository for the Hub. Thin wrapper over the
// generated SDK functions (listPersonas / createPersona / updatePersona /
// deletePersona / setActivePersona) with row↔PersonaData mapping and typed
// domain-error mapping. Pure module (no Svelte runes, no Firebase imports
// beyond the shared Data Connect singleton) so it is import-safe in both the
// client bundle and the Bun SSR load.
//
// Error mapping: raw DataConnectError / Firebase shapes are never leaked to
// the ViewModel. SDK failures become AppError-shaped domain errors
// (unauthenticated / not-found / already-exists / internal) via @aikami/utils
// toAppError, mirroring FirebaseDataConnectService.toDomainError.
//
// Ownership: every write operation's @auth(expr: "auth.uid ==
// request.variables.uid") + id/uid-scoped where/key clauses reject
// cross-user access server-side; the repository additionally treats a zero
// affected-row count as a typed not-found error ("Persona not found",
// preserving the Firestore path's behavior).
import {
  activatePersona,
  createPersona,
  dataConnect,
  deactivatePersonas,
  deletePersona,
  getPersona,
  listPersonas,
  updatePersona,
} from '@aikami/frontend/dataconnect';
import type { PersonaData } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { logger } from '$logger';
import {
  isAppError,
  mapDataConnectError,
  mergeUpdateFields,
  type PersonaCreateRowInput,
  type PersonaRow,
  type PersonaUpdateRowInput,
  rowToData,
  toCreateRow,
  toUpdateRow,
} from './persona_mapper.ts';

/**
 * Repository facade over the generated Data Connect persona operations.
 * Implemented as a plain module (arrow functions on a const object) so it
 * stays import-safe in client and SSR and needs no BaseClass machinery.
 */
export type PersonaRepository = {
  /** Lists the owning user's personas, ordered createdAt DESC (server-side). */
  listByOwner(options: { uid: string }): Promise<PersonaData[]>;
  /** Creates a persona; returns the new persona id. */
  create(options: { uid: string; data: PersonaCreateRowInput }): Promise<string>;
  /** Updates a persona (owner-only). */
  update(options: { uid: string; personaId: string; data: PersonaUpdateRowInput }): Promise<void>;
  /** Deletes a persona (owner-only). */
  remove(options: { uid: string; personaId: string }): Promise<void>;
  /** Sets a persona active, deactivating all other personas of the user. */
  setActive(options: { uid: string; personaId: string }): Promise<void>;
};

/**
 * Maps a raw Data Connect / network error into an AppError-shaped domain
 * error, logging the raw message first (operation context only — never the
 * persona payload). See persona_mapper.mapDataConnectError for the mapping.
 */
const mapAndLogError = (operation: string, raw: unknown): Error => {
  logger.error(`personaRepository.${operation}:error`, {
    message: raw instanceof Error ? raw.message : String(raw),
  });
  return mapDataConnectError(operation, raw);
};

/**
 * Maximum personas a user may own. Mirrors the ListPersonas `limit: 100` so
 * the list is never silently truncated: create fails with resource-exhausted
 * at this ceiling, and every write path resolves the target row by id via
 * GetPersona (never via the capped list).
 */
const MAX_PERSONAS_PER_USER = 100;

const listByOwner = async (options: { uid: string }): Promise<PersonaData[]> => {
  const { uid } = options;
  logger.debug('personaRepository.listByOwner', { uid });
  try {
    // SERVER_ONLY fetch policy: the SDK's default PREFER_CACHE serves a
    // stale list right after create/update/delete/activate (mutations do not
    // invalidate the query cache), which would break the ViewModel refresh.
    const result = await listPersonas(dataConnect, { uid }, { fetchPolicy: 'SERVER_ONLY' });
    const rows = result.data.personas ?? [];
    return rows.map((row: PersonaRow) => rowToData(row));
  } catch (error) {
    throw mapAndLogError('listByOwner', error);
  }
};

/**
 * Resolves a single owned persona by id (owner-scoped, id+uid where). Throws
 * the typed not-found error when the row is missing or belongs to another
 * user. Used by update/setActive so those paths never depend on the
 * 100-row ListPersonas cap.
 */
const getOwnedPersona = async (options: {
  uid: string;
  personaId: string;
}): Promise<PersonaData> => {
  const { uid, personaId } = options;
  try {
    const result = await getPersona(dataConnect, { id: personaId, uid });
    const row = result.data.personas?.[0];
    if (!row) {
      throw toAppError({ errorType: 'not-found', errorMessage: 'Persona not found' });
    }
    return rowToData(row);
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    throw mapAndLogError('getOwnedPersona', error);
  }
};

const create = async (options: { uid: string; data: PersonaCreateRowInput }): Promise<string> => {
  const { uid, data } = options;
  const id = `persona_${crypto.randomUUID()}`;
  logger.debug('personaRepository.create', { uid, personaId: id });

  // Enforce the ListPersonas ceiling so no user can ever exceed the 100-row
  // list (which would silently hide personas from the UI and from
  // listByOwner-based flows).
  const existing = await listByOwner({ uid });
  if (existing.length >= MAX_PERSONAS_PER_USER) {
    throw toAppError({
      errorType: 'resource-exhausted',
      errorMessage: `Persona limit reached (${MAX_PERSONAS_PER_USER}). Delete a persona before creating another.`,
    });
  }

  try {
    const result = await createPersona(dataConnect, toCreateRow({ id, uid, data }));
    return result.data.persona_insert.id;
  } catch (error) {
    throw mapAndLogError('create', error);
  }
};

const update = async (options: {
  uid: string;
  personaId: string;
  data: PersonaUpdateRowInput;
}): Promise<void> => {
  const { uid, personaId, data } = options;
  logger.debug('personaRepository.update', { uid, personaId });

  // Partial updates need the current row to merge unmentioned fields (the
  // mutation overwrites every provided column; null would clear them).
  // Resolve by id via GetPersona — never via the capped list — so a persona
  // beyond the first 100 stays updatable.
  const existing = await getOwnedPersona({ uid, personaId });

  try {
    const result = await updatePersona(
      dataConnect,
      toUpdateRow({ uid, personaId, data: mergeUpdateFields(existing, data) }),
    );
    // Zero affected rows ⇒ the row was deleted or ownership changed between
    // the read and the write — fail closed with the typed not-found error.
    if (result.data.persona_updateMany === 0) {
      throw toAppError({ errorType: 'not-found', errorMessage: 'Persona not found' });
    }
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    throw mapAndLogError('update', error);
  }
};

const remove = async (options: { uid: string; personaId: string }): Promise<void> => {
  const { uid, personaId } = options;
  logger.debug('personaRepository.remove', { uid, personaId });
  try {
    const result = await deletePersona(dataConnect, { id: personaId, uid });
    if (result.data.persona_deleteMany === 0) {
      throw toAppError({ errorType: 'not-found', errorMessage: 'Persona not found' });
    }
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    throw mapAndLogError('remove', error);
  }
};

const setActive = async (options: { uid: string; personaId: string }): Promise<void> => {
  const { uid, personaId } = options;
  logger.debug('personaRepository.setActive', { uid, personaId });

  // Validate the target row exists AND belongs to the caller BEFORE any
  // mutation: deactivating-all first would otherwise clear the current active
  // persona and then fail on a missing/foreign target, leaving zero active
  // rows. Resolving via GetPersona also keeps this path independent of the
  // 100-row list cap.
  await getOwnedPersona({ uid, personaId });

  try {
    // Two server-side steps (the dialect rejects two `persona_updateMany`
    // selections in one mutation, and raw-SQL _executeReturning fails
    // against the pinned pglite emulator — see queries.gql). Deactivate-all
    // first, then activate the target; the partial unique index
    // (uid) WHERE is_active is the concurrency backstop that turns a
    // concurrent activation of a different persona into a unique-violation
    // conflict instead of two active rows.
    await deactivatePersonas(dataConnect, { uid });
    const result = await activatePersona(dataConnect, { id: personaId, uid });
    // Zero affected rows ⇒ the target persona is missing OR not owned
    // (already validated above; a race between validation and activation is
    // possible and fails closed here).
    if (result.data.persona_updateMany === 0) {
      throw toAppError({ errorType: 'not-found', errorMessage: 'Persona not found' });
    }
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    throw mapAndLogError('setActive', error);
  }
};

export const personaRepository: PersonaRepository = {
  listByOwner,
  create,
  update,
  remove,
  setActive,
};
