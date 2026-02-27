import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { authService, personaService } from '$services/index.ts';

export type PersonaListViewModelOptions = BaseViewModelOptions;

export type PersonaListViewModelInterface = BaseViewModelInterface & {
  readonly personas: PersonaData[];
  readonly isLoading: boolean;
};

class PersonaListViewModel
  extends BaseViewModel<PersonaListViewModelOptions>
  implements PersonaListViewModelInterface
{
  personas = $state<PersonaData[]>([]);
  isLoading = $state<boolean>(false);

  override async initialize(): Promise<void> {
    this.setAppLoading(true);
    try {
      const user = authService.currentUser;
      if (user) {
        this.personas = await personaService.getPersonas(user.id);
      }
    } catch (err) {
      this.error('initialize', err);
    } finally {
      this.setAppLoading(false);
    }
    super.initialize();
  }
}

export const getPersonaListViewModel = (
  options: PersonaListViewModelOptions,
): PersonaListViewModelInterface => new PersonaListViewModel(options);
