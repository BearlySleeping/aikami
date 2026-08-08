// apps/frontend/hub/src/lib/client/services/dataconnect/persona_data.svelte.ts
//
// Persona management service for the Hub. Lets a signed-in user browse,
// create, activate and delete their own personas (community content).
// Mirrors the client's persona service (apps/frontend/client/src/lib/services/
// persona/persona_firestore.svelte.ts) plus a createPersona method.
//
// Data layer: personas live in the SQL `Persona` table behind Firebase Data
// Connect. The public interface is byte-identical to the previous Firestore
// service — the ViewModel and View are untouched consumers. Ownership is
// enforced server-side (@auth(expr: "auth.uid == request.variables.uid") +
// id/uid-scoped writes); the repository maps rows to the shared PersonaData
// shape and wraps SDK errors into typed domain errors.
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { PersonaCreateSchema, PersonaUpdateSchema, schemaCheck } from '@aikami/schemas';
import type { PersonaCreateData, PersonaData } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { authService } from '$services';
import { personaRepository } from './persona_repository.ts';

export type PersonaDataServiceOptions = BaseFrontendClassOptions;

/**
 * Fields callers may edit on a persona. Excludes ownership (`uid`, `id`) and
 * activation state (`isActive`), which are managed internally.
 */
export type PersonaUpdateFields = Omit<Partial<PersonaData>, 'uid' | 'id' | 'isActive'>;

export type PersonaDataServiceInterface = BaseFrontendClassInterface & {
  /**
   * Retrieves all personas owned by a given user.
   * @param uid The user's ID.
   * @returns A promise that resolves to an array of persona data.
   */
  getPersonas(uid: string): Promise<PersonaData[]>;

  /**
   * Creates a new persona for the currently signed-in user.
   * @param data Minimal persona fields (name is required by the schema).
   * @returns The id of the newly created persona.
   */
  createPersona(data: { name: string }): Promise<string>;

  /**
   * Sets a persona as the active one (game-style — one character per run).
   * Deactivates all other personas owned by the user.
   * @param personaId The ID of the persona to set as active.
   */
  setActivePersona(personaId: string): Promise<void>;

  /**
   * Updates an existing persona (owner-only). Ownership and activation state
   * cannot be changed through this method.
   * @param personaId The persona ID.
   * @param data Safe editable fields.
   */
  updatePersona(personaId: string, data: PersonaUpdateFields): Promise<void>;

  /**
   * Deletes a persona (owner-only).
   * @param personaId The persona ID.
   */
  deletePersona(personaId: string): Promise<void>;
};

class PersonaDataService
  extends BaseFrontendClass<PersonaDataServiceOptions>
  implements PersonaDataServiceInterface
{
  /** @throws if the current user is not signed in. */
  private _requireUser(): { id: string } {
    const user = authService.currentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }
    return user;
  }

  async getPersonas(uid: string): Promise<PersonaData[]> {
    return await personaRepository.listByOwner({ uid });
  }

  async createPersona(data: { name: string }): Promise<string> {
    const user = this._requireUser();

    const createData: PersonaCreateData & { isActive: boolean } = {
      ...data,
      isActive: false,
    };

    // Repository-level schema enforcement (replaces the Firestore path's
    // createSchema validation) — `traits` has no server-side validation, so
    // this is the only gate on what gets written.
    if (!schemaCheck(PersonaCreateSchema, createData)) {
      throw toAppError({ errorType: 'invalid-argument', errorMessage: 'Invalid persona data' });
    }

    return await personaRepository.create({ uid: user.id, data: createData });
  }

  async setActivePersona(personaId: string): Promise<void> {
    const user = this._requireUser();
    await personaRepository.setActive({ uid: user.id, personaId });
  }

  async updatePersona(personaId: string, data: PersonaUpdateFields): Promise<void> {
    const user = this._requireUser();

    if (!schemaCheck(PersonaUpdateSchema, data)) {
      throw toAppError({ errorType: 'invalid-argument', errorMessage: 'Invalid persona data' });
    }

    await personaRepository.update({ uid: user.id, personaId, data });
  }

  async deletePersona(personaId: string): Promise<void> {
    const user = this._requireUser();
    await personaRepository.remove({ uid: user.id, personaId });
  }
}

export const personaDataService: PersonaDataServiceInterface = PersonaDataService.create({
  className: 'PersonaDataService',
});
