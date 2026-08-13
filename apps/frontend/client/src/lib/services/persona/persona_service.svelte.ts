// apps/frontend/client/src/lib/services/persona/persona_service.svelte.ts
//
// Persona service — local-first. Reads and writes personas through the
// local SQLite repository (persona_storage). No Firestore in the path.
//
// Contract: C-386b — Firestore Removal, personas local-first.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { personaStorage } from './persona_storage.svelte.ts';

export type PersonaServiceOptions = BaseFrontendClassOptions;

export type PersonaServiceInterface = BaseFrontendClassInterface & {
  /**
   * Checks if at least one persona exists on this device.
   * @returns A promise that resolves to true if a persona exists, false otherwise.
   */
  hasPersona(): Promise<boolean>;

  /**
   * Retrieves all personas (per-install — uid accepted for API parity).
   * @param uid The user's ID.
   * @returns A promise that resolves to an array of persona data.
   */
  getPersonas(uid: string): Promise<PersonaData[]>;

  /**
   * Gets the currently active persona for the user.
   * @returns The active persona or undefined if none is active.
   */
  getActivePersona(): Promise<PersonaData | undefined>;

  /**
   * Sets a persona as the active one (game-style - one character for entire run).
   * This deactivates all other personas atomically.
   * @param personaId The ID of the persona to set as active.
   */
  setActivePersona(personaId: string): Promise<void>;

  /**
   * Updates an existing persona (or creates it when missing).
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

class PersonaService
  extends BaseFrontendClass<PersonaServiceOptions>
  implements PersonaServiceInterface
{
  async hasPersona(): Promise<boolean> {
    return await personaStorage.hasPersona();
  }

  async getPersonas(uid: string): Promise<PersonaData[]> {
    return await personaStorage.getPersonas(uid);
  }

  async getActivePersona(): Promise<PersonaData | undefined> {
    return await personaStorage.getActivePersona();
  }

  async setActivePersona(personaId: string): Promise<void> {
    await personaStorage.setActivePersona(personaId);
  }

  async updatePersona(personaId: string, data: Partial<PersonaData>): Promise<void> {
    await personaStorage.updatePersona(personaId, data);
  }

  async deletePersona(personaId: string): Promise<void> {
    await personaStorage.deletePersona(personaId);
  }
}

export const personaService: PersonaServiceInterface = PersonaService.create({
  className: 'PersonaService',
});
