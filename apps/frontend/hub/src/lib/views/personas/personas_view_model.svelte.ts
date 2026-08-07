// apps/frontend/hub/src/lib/views/personas/personas_view_model.svelte.ts
//
// ViewModel for browsing and managing the signed-in user's own personas.
// The page is SSR-seeded: `data.personas` (loaded server-side in
// +page.server.ts) paints instantly, then initialize() refreshes from
// Firestore once auth has resolved.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { authService, personaDataService } from '$services';
import type { PersonasPageData } from '$types';

export type PersonasViewModelOptions = BaseViewModelOptions & {
  /** SSR-seeded personas for instant first paint. */
  data?: PersonasPageData;
};

export type PersonasViewModelInterface = BaseViewModelInterface & {
  /** The current user's personas. */
  readonly personas: PersonaData[];
  readonly isLoading: boolean;
  readonly isCreating: boolean;
  /** Bound to the "new persona" name input. */
  readonly newPersonaName: string;
  setNewPersonaName(name: string): void;
  createPersona(): Promise<void>;
  setActivePersona(personaId: string): Promise<void>;
  deletePersona(personaId: string): Promise<void>;
  refresh(): Promise<void>;
};

class PersonasViewModel
  extends BaseViewModel<PersonasViewModelOptions>
  implements PersonasViewModelInterface
{
  personas = $state<PersonaData[]>([]);
  isLoading = $state(false);
  isCreating = $state(false);
  newPersonaName = $state('');

  constructor(options: PersonasViewModelOptions) {
    super(options);
    // Seed instantly from the SSR data so the first paint has content
    // without waiting on Firestore or the auth restore.
    if (options.data?.personas?.length) {
      this.personas = options.data.personas;
    }
  }

  setNewPersonaName(name: string): void {
    this.newPersonaName = name;
  }

  override async initialize(): Promise<void> {
    // Wait for Firebase Auth to resolve (IndexedDB restore on refresh),
    // then refresh so the list matches the signed-in user's data.
    await authService.initialize();
    await this.refresh();
    await super.initialize();
  }

  async refresh(): Promise<void> {
    this.isLoading = true;
    try {
      const user = authService.currentUser;
      if (!user) {
        this.personas = [];
        return;
      }
      this.personas = await personaDataService.getPersonas(user.id);
    } catch (error) {
      this.error('refresh', error);
      this.errorMessage = error instanceof Error ? error.message : 'Failed to load personas';
    } finally {
      this.isLoading = false;
    }
  }

  async createPersona(): Promise<void> {
    const name = this.newPersonaName.trim();
    if (!name) {
      this.errorMessage = 'Please enter a persona name.';
      return;
    }
    this.isCreating = true;
    this.errorMessage = undefined;
    try {
      await personaDataService.createPersona({ name });
      this.newPersonaName = '';
      await this.refresh();
    } catch (error) {
      this.error('createPersona', error);
      this.errorMessage = error instanceof Error ? error.message : 'Failed to create persona';
    } finally {
      this.isCreating = false;
    }
  }

  async setActivePersona(personaId: string): Promise<void> {
    this.errorMessage = undefined;
    try {
      await personaDataService.setActivePersona(personaId);
      await this.refresh();
    } catch (error) {
      this.error('setActivePersona', error);
      this.errorMessage = error instanceof Error ? error.message : 'Failed to set active persona';
    }
  }

  async deletePersona(personaId: string): Promise<void> {
    const confirmed = await this.openConfirmDialog({
      title: 'Delete persona',
      message: 'Are you sure you want to delete this persona? This cannot be undone.',
      agreeColor: 'danger',
      agreeLabel: 'Delete',
      disagreeLabel: 'Cancel',
    });
    if (!confirmed) {
      return;
    }
    this.errorMessage = undefined;
    try {
      await personaDataService.deletePersona(personaId);
      await this.refresh();
    } catch (error) {
      this.error('deletePersona', error);
      this.errorMessage = error instanceof Error ? error.message : 'Failed to delete persona';
    }
  }
}

export const getPersonasViewModel = (
  options: PersonasViewModelOptions,
): PersonasViewModelInterface => PersonasViewModel.create(options);
