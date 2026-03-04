import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { toAppErrorFromUnknownError } from '@aikami/utils';
import { aiService, authService, personaService, storageService } from '$services';

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
  generatedPersona: PersonaData | null;
  readonly isLoading: boolean;
  readonly isUploading: boolean;
  readonly isOnboarding: boolean;

  createPersonaFromAI(): Promise<void>;
  uploadAvatar(file: File): Promise<void>;
  savePersona(): Promise<PersonaData | null>;
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
  generatedPersona = $state<PersonaData | null>(null);
  isOnboarding = $derived(this._options.isOnboarding ?? false);

  async skipOnboarding(): Promise<void> {
    const { goto } = await import('$app/navigation');
    await goto('/dashboard');
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

  async savePersona(): Promise<PersonaData | null> {
    const user = authService.currentUser;
    if (!user || !this.name) {
      return null;
    }

    this.isLoading = true;

    try {
      const { personaRepository } = await import('@aikami/frontend/repositories/persona.ts');
      // Use generated persona data as base, override with user edits
      const {
        id: _id,
        createdAt: _c,
        updatedAt: _u,
        priority: _p,
        ...baseData
      } = this.generatedPersona ?? ({} as PersonaData);
      const newPersonaId = await personaRepository.addDocument({
        getCollectionPathArgument: { uid: user.id },
        createData: {
          ...baseData,
          name: this.name,
          notes: this.backstory,
          avatarUrl: this.avatarUrl || undefined,
          uid: user.id,
          isActive: false,
        },
      });
      const newPersona = await personaRepository.getDocument({
        uid: user.id,
        personaId: newPersonaId,
      });
      return newPersona ?? null;
    } catch (error) {
      this.error('savePersona', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
      return null;
    } finally {
      this.isLoading = false;
    }
  }
}

export const getPersonaCreationViewModel = (
  options: PersonaCreationViewModelOptions,
): PersonaCreationViewModelInterface => new PersonaCreationViewModel(options);
