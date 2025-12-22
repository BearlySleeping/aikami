import { authService } from '$services'
import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services'
import type { PersonaData } from '@aikami/types'
import { personaRepository } from '@aikami/frontend/repositories/persona.ts'

export type PersonaServiceInterface = BaseFrontendClassInterface & {
  /**
   * Checks if the current user has at least one persona.
   * @returns A promise that resolves to true if a persona exists, false otherwise.
   */
  hasPersona(): Promise<boolean>

  /**
   * Retrieves all personas for a given user.
   * @param uid The user's ID.
   * @returns A promise that resolves to an array of persona data.
   */
  getPersonas(uid: string): Promise<PersonaData[]>
}

class PersonaService extends BaseFrontendClass implements PersonaServiceInterface {
  constructor() {
    super({ className: 'PersonaService' })
  }

  async hasPersona(): Promise<boolean> {
    const user = authService.currentUser
    if (!user) return false
    const personas = await personaRepository.getDocumentsByCollection({ uid: user.id })
    return personas.length > 0
  }

  async getPersonas(uid: string): Promise<PersonaData[]> {
    return await personaRepository.getDocumentsByCollection({ uid })
  }
}

export const personaService: PersonaServiceInterface = new PersonaService()
