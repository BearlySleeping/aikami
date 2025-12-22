import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services'
import { routerService } from '$services'

export type DashboardViewModelOptions = BaseViewModelOptions

export type DashboardViewModelInterface = BaseViewModelInterface & {
  /**
   * Navigates to the character creator page.
   */
  goToCharacterCreator(): Promise<void>
}

class DashboardViewModel extends BaseViewModel<DashboardViewModelOptions>
  implements DashboardViewModelInterface {
  async goToCharacterCreator(): Promise<void> {
    await routerService.goToRoute('personas/create', {
      pathParameters: undefined,
      queryParameters: undefined,
    })
  }
}

export const getDashboardViewModel = (
  options: DashboardViewModelOptions,
): DashboardViewModelInterface => new DashboardViewModel(options)
