import { aiService } from '$services'
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services'
import type { PersonaData } from '@aikami/types'
import { toAppErrorFromUnknownError } from '@aikami/utils'

export type PersonaCreationViewModelOptions = BaseViewModelOptions

export type PersonaCreationViewModelInterface = BaseViewModelInterface & {
  name: string
  backstory: string
  appearance: {
    hair: string
    eyes: string
    skin: string
  }
  prompt: string
  generatedPersona: PersonaData | null
  readonly isLoading: boolean

  createPersonaFromAI(): Promise<void>
}

class PersonaCreationViewModel extends BaseViewModel<PersonaCreationViewModelOptions>
  implements PersonaCreationViewModelInterface {
  name = $state('')
  backstory = $state('')
  appearance = $state({
    hair: '',
    eyes: '',
    skin: '',
  })
  isLoading = $state(false)
  prompt = $state('')
  generatedPersona = $state<PersonaData | null>(null)

  async createPersonaFromAI(): Promise<void> {
    if (!this.prompt || this.isLoading) {
      return
    }

    this.isLoading = true

    try {
      const persona = await aiService.createPersona(this.prompt)
      if (persona) {
        this.generatedPersona = persona
        this.name = persona.name
        this.backstory = persona.notes ?? ''
      }
    } catch (error) {
      this.error('createPersonaFromAI', error)
      const appError = toAppErrorFromUnknownError(error)
      this.errorMessage = appError.message
    } finally {
      this.isLoading = false
    }
  }
}

export const getPersonaCreationViewModel = (
  options: PersonaCreationViewModelOptions,
): PersonaCreationViewModelInterface => new PersonaCreationViewModel(options)
