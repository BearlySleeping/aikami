// apps/frontend/hub/src/lib/views/dashboard/dashboard_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { authService, personaDataService, routerService } from '$services';

export type DashboardViewModelOptions = BaseViewModelOptions;

export type DashboardViewModelInterface = BaseViewModelInterface & {
  /** Number of personas the signed-in user has created. */
  readonly personaCount: number;
  readonly isLoading: boolean;
  goToPersonas(): Promise<void>;
};

class DashboardViewModel
  extends BaseViewModel<DashboardViewModelOptions>
  implements DashboardViewModelInterface
{
  personaCount = $state(0);
  isLoading = $state(true);

  override async initialize(): Promise<void> {
    // Wait for Firebase Auth to resolve (IndexedDB restore on refresh).
    await authService.initialize();

    const user = authService.currentUser;
    if (user) {
      try {
        const personas = await personaDataService.getPersonas(user.id);
        this.personaCount = personas.length;
      } catch (error) {
        this.error('initialize:loadPersonaCount', error);
      }
    }

    this.isLoading = false;
    await super.initialize();
  }

  async goToPersonas(): Promise<void> {
    try {
      await routerService.goToRoute('personas', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('goToPersonas', error);
    }
  }
}

export const getDashboardViewModel = (
  options: DashboardViewModelOptions,
): DashboardViewModelInterface => DashboardViewModel.create(options);
