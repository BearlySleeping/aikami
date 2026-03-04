import { personaRepository } from '@aikami/frontend/repositories/persona.ts';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { authService } from '$services';

export type PersonaServiceInterface = BaseFrontendClassInterface & {
  /**
   * Checks if the current user has at least one persona.
   * @returns A promise that resolves to true if a persona exists, false otherwise.
   */
  hasPersona(): Promise<boolean>;

  /**
   * Retrieves all personas for a given user.
   * @param uid The user's ID.
   * @returns A promise that resolves to an array of persona data.
   */
  getPersonas(uid: string): Promise<PersonaData[]>;

  /**
   * Gets the currently active persona for the user.
   * @returns The active persona or null if none is active.
   */
  getActivePersona(): Promise<PersonaData | null>;

  /**
   * Sets a persona as the active one (game-style - one character for entire run).
   * This deactivates all other personas for the user.
   * @param personaId The ID of the persona to set as active.
   */
  setActivePersona(personaId: string): Promise<void>;

  /**
   * Updates an existing persona.
   * @param personaId The persona ID.
   * @param data The update data.
   */
  updatePersona(personaId: string, data: Partial<PersonaData>): Promise<void>;

  /**
   * Deletes a persona.
   * @param personaId The persona ID.
   */
  deletePersona(personaId: string): Promise<void>;
};

class PersonaService extends BaseFrontendClass implements PersonaServiceInterface {
  constructor() {
    super({ className: 'PersonaService' });
  }

  async hasPersona(): Promise<boolean> {
    const user = authService.currentUser;
    if (!user) return false;
    const personas = await personaRepository.getDocumentsByCollection({
      uid: user.id,
    });
    return personas.length > 0;
  }

  async getPersonas(uid: string): Promise<PersonaData[]> {
    return await personaRepository.getDocumentsByCollection({ uid });
  }

  async getActivePersona(): Promise<PersonaData | null> {
    const user = authService.currentUser;
    if (!user) return null;

    const personas = await personaRepository.getDocumentsByCollection({ uid: user.id });
    return personas.find((p: PersonaData) => p.isActive) ?? null;
  }

  async setActivePersona(personaId: string): Promise<void> {
    const user = authService.currentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }

    const personas = await personaRepository.getDocumentsByCollection({ uid: user.id });

    const updates = personas.map(async (persona: PersonaData) => {
      const shouldBeActive = persona.id === personaId;
      if (persona.isActive !== shouldBeActive) {
        await personaRepository.updateDocument({
          getDocumentPathArgument: { uid: user.id, personaId: persona.id },
          updateData: { isActive: shouldBeActive },
        });
      }
    });

    await Promise.all(updates);
  }

  async updatePersona(personaId: string, data: Partial<PersonaData>): Promise<void> {
    const user = authService.currentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }
    await personaRepository.updateDocument({
      getDocumentPathArgument: { uid: user.id, personaId },
      updateData: data,
    });
  }

  async deletePersona(personaId: string): Promise<void> {
    const user = authService.currentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }
    await personaRepository.deleteDocument({ uid: user.id, personaId });
  }
}

export const personaService: PersonaServiceInterface = new PersonaService();
