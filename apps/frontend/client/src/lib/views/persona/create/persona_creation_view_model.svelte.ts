// apps/frontend/client/src/lib/views/persona/create/persona-creation-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { toAppErrorFromUnknownError } from '@aikami/utils';
import { aiService, authService, storageService } from '$services';

export type PersonaCreationViewModelOptions = BaseViewModelOptions & {
  isOnboarding?: boolean;
};

export type PersonaCreationViewModelInterface = BaseViewModelInterface & {
  name: string;
  backstory: string;
  appearance: {
    hair: string;
    eyes: string;
    skin: string;
  };
  avatarUrl: string;
  prompt: string;
  generatedPersona: PersonaData | undefined;
  readonly isLoading: boolean;
  readonly isUploading: boolean;
  readonly isOnboarding: boolean;

  createPersonaFromAI(): Promise<void>;
  uploadAvatar(file: File): Promise<void>;
  savePersona(): Promise<PersonaData | undefined>;
  regenerate(): Promise<void>;
  skipOnboarding(): Promise<void>;
};

class PersonaCreationViewModel
  extends BaseViewModel<PersonaCreationViewModelOptions>
  implements PersonaCreationViewModelInterface
{
  name = $state('');
  backstory = $state('');
  appearance = $state({
    hair: '',
    eyes: '',
    skin: '',
  });
  avatarUrl = $state('');
  isLoading = $state(false);
  isUploading = $state(false);
  prompt = $state('');
  generatedPersona = $state<PersonaData | undefined>(undefined);
  isOnboarding = $derived(this._options.isOnboarding ?? false);

  async skipOnboarding(): Promise<void> {
    const { goto } = await import('$app/navigation');
    await goto('/settings');
  }

  async createPersonaFromAI(): Promise<void> {
    if (!this.prompt || this.isLoading) {
      return;
    }

    this.isLoading = true;

    try {
      const persona = await aiService.createPersona(this.prompt);
      if (persona) {
        this.generatedPersona = persona;
        this.name = persona.name;
        this.backstory = persona.notes ?? '';
      }
    } catch (error) {
      this.error('createPersonaFromAI', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    } finally {
      this.isLoading = false;
    }
  }

  async uploadAvatar(file: File): Promise<void> {
    const user = authService.currentUser;
    if (!user || this.isUploading) {
      return;
    }

    this.isUploading = true;

    try {
      const path = await storageService.uploadAvatar({ file, uid: user.id });
      if (path) {
        this.avatarUrl = path;
      }
    } catch (error) {
      this.error('uploadAvatar', error);
    } finally {
      this.isUploading = false;
    }
  }

  async savePersona(): Promise<PersonaData | undefined> {
    const { goto } = await import('$app/navigation');
    if (!this.generatedPersona?.id) {
      return undefined;
    }

    this.isLoading = true;

    try {
      await goto('/personas');
      return this.generatedPersona;
    } catch (error) {
      this.error('savePersona', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
      return undefined;
    } finally {
      this.isLoading = false;
    }
  }

  async regenerate(): Promise<void> {
    this.generatedPersona = undefined;
    this.name = '';
    this.backstory = '';
  }
}

export const getPersonaCreationViewModel = (
  options: PersonaCreationViewModelOptions,
): PersonaCreationViewModelInterface => new PersonaCreationViewModel(options);
