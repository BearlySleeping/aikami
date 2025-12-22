import { authService, personaService, routerService } from '$services'
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services'
import type { CurrentUser, PersonaData } from '@aikami/types'
import t from '$i18n'

export type ProfileViewModelOptions = BaseViewModelOptions

export type ProfileViewModelInterface = BaseViewModelInterface & {
  /**
   * The current user.
   */
  readonly user: CurrentUser | null
  /**
   * A readonly array of characters.
   */
  readonly characters: readonly PersonaData[]

  /**
   * Navigates to the character page.
   * @param characterId The ID of the character to navigate to.
   */
  goToCharacter(characterId: string): Promise<void>

  /**
   * Signs the user out.
   */ signOut(): Promise<void>
}

class ProfileViewModel extends BaseViewModel implements ProfileViewModelInterface {
  user = $state<CurrentUser | null>(null)
  characters = $state<PersonaData[]>([])

  override async initialize(): Promise<void> {
    this.setAppLoading(true)
    this.user = authService.currentUser ?? null
    if (!this.user) {
      this.showErrorNotification(new Error(t.error_user_not_found()))
      this.setAppLoading(false)
      return
    }

    try {
      this.characters = await personaService.getPersonas(this.user.id)
    } catch (error) {
      this.showErrorNotification(error)
    } finally {
      this.setAppLoading(false)
    }
  }

  async goToCharacter(characterId: string): Promise<void> {
    await routerService.goToRoute('character/[id]', {
      pathParameters: { id: characterId },
      queryParameters: undefined,
    })
  }

  async signOut(): Promise<void> {
    await authService.signOut()
    await routerService.goToRoute('login', {
      pathParameters: undefined,
      queryParameters: undefined,
    })
  }
}

export const getProfileViewModel = (
  options: ProfileViewModelOptions,
): ProfileViewModelInterface => new ProfileViewModel(options)
