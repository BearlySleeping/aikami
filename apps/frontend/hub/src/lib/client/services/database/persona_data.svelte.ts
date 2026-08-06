// apps/frontend/hub/src/lib/client/services/database/persona_data.svelte.ts
//
// Persona management service for the Hub. Lets a signed-in user browse,
// create, activate and delete their own personas (community content).
// Mirrors the client's persona service (apps/frontend/client/src/lib/services/
// persona/persona_repository.svelte.ts) plus a createPersona method.
//
// Personas live in a shared top-level `personas` collection where each
// document carries an owner `uid` field — every query here filters by the
// current user's uid so only their own personas are ever touched.
import { personaRepository } from '@aikami/frontend/repositories/persona.ts';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import type { BatchCommand } from '@aikami/types';
import { authService } from '$services';

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

  /** Verifies the persona exists and is owned by the current user. */
  private async _getOwnedPersona(personaId: string): Promise<PersonaData> {
    const user = this._requireUser();
    const persona = await personaRepository.getDocument({ uid: user.id, personaId });
    if (!persona || persona.uid !== user.id) {
      throw new Error('Persona not found');
    }
    return persona;
  }

  async getPersonas(uid: string): Promise<PersonaData[]> {
    return await personaRepository.getDocumentsByQuery({
      filters: [
        {
          field: 'uid',
          operator: '==',
          value: uid,
        },
      ],
      getCollectionPathArgument: { uid },
    });
  }

  async createPersona(data: { name: string }): Promise<string> {
    const user = this._requireUser();
    return await personaRepository.addDocument({
      getCollectionPathArgument: { uid: user.id },
      createData: {
        ...data,
        uid: user.id,
        isActive: false,
      },
    });
  }

  async setActivePersona(personaId: string): Promise<void> {
    const user = this._requireUser();

    const personas = await this.getPersonas(user.id);
    const target = personas.find((persona: PersonaData) => persona.id === personaId);
    if (!target) {
      throw new Error('Persona not found');
    }

    // Apply the activation change as one atomic Firestore write batch, so
    // concurrent requests cannot leave multiple personas active.
    // (data is cast to BatchCommand['data'] — the repository class applies
    // the same cast internally when committing.)
    const commands = personas
      .filter((persona: PersonaData) => persona.isActive !== (persona.id === personaId))
      .map(
        (persona: PersonaData) =>
          ({
            type: 'update' as const,
            data: { isActive: persona.id === personaId },
            documentPathArgument: { uid: user.id, personaId: persona.id },
          }) as unknown as BatchCommand,
      );

    await personaRepository.commit(commands);
  }

  async updatePersona(personaId: string, data: PersonaUpdateFields): Promise<void> {
    await this._getOwnedPersona(personaId);
    const user = this._requireUser();
    await personaRepository.updateDocument({
      getDocumentPathArgument: { uid: user.id, personaId },
      updateData: data,
    });
  }

  async deletePersona(personaId: string): Promise<void> {
    await this._getOwnedPersona(personaId);
    const user = this._requireUser();
    await personaRepository.deleteDocument({ uid: user.id, personaId });
  }
}

export const personaDataService: PersonaDataServiceInterface = PersonaDataService.create({
  className: 'PersonaDataService',
});
