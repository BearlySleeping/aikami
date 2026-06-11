// apps/frontend/client/src/lib/views/settings/settings-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { CoreFormSchema } from '@aikami/schemas';
import Type from 'typebox';
import { authService, dialogService, routerService } from '$services';

const ProfileFormSchema = Type.Intersect([
  CoreFormSchema,
  Type.Object({
    displayName: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1, format: 'email' }),
    phoneNumber: Type.Optional(Type.String()),
  }),
]);

const PreferencesFormSchema = Type.Intersect([
  CoreFormSchema,
  Type.Object({
    theme: Type.Union([Type.Literal('system'), Type.Literal('light'), Type.Literal('dark')]),
    language: Type.Union([Type.Literal('en'), Type.Literal('es'), Type.Literal('fr')]),
    notifications: Type.Boolean(),
  }),
]);

type ProfileFormData = Type.Static<typeof ProfileFormSchema>;
type PreferencesFormData = Type.Static<typeof PreferencesFormSchema>;

export type SettingsViewModelOptions = BaseViewModelOptions;

export type SettingsViewModelInterface = BaseViewModelInterface & {
  readonly profileForm: ProfileFormData;
  readonly profileErrors: Partial<Record<keyof ProfileFormData, string>>;
  readonly isProfileSubmitting: boolean;
  readonly preferencesForm: PreferencesFormData;
  readonly preferencesErrors: Partial<Record<keyof PreferencesFormData, string>>;
  readonly isPreferencesSubmitting: boolean;
  updateProfileField(key: keyof ProfileFormData, value: string): void;
  updatePreferencesField(key: keyof PreferencesFormData, value: string | boolean): void;
  saveProfile(): Promise<void>;
  savePreferences(): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
};

class SettingsViewModel
  extends BaseViewModel<SettingsViewModelOptions>
  implements SettingsViewModelInterface
{
  private _profileForm = $state<ProfileFormData>({
    displayName: '',
    email: '',
  });

  private _profileErrors = $state<Partial<Record<keyof ProfileFormData, string>>>({});

  private _isProfileSubmitting = $state(false);

  private _preferencesForm = $state<PreferencesFormData>({
    theme: 'system',
    language: 'en',
    notifications: true,
  });

  private _preferencesErrors = $state<Partial<Record<keyof PreferencesFormData, string>>>({});

  private _isPreferencesSubmitting = $state(false);

  profileForm = $derived(this._profileForm);
  profileErrors = $derived(this._profileErrors);
  isProfileSubmitting = $derived(this._isProfileSubmitting);

  preferencesForm = $derived(this._preferencesForm);
  preferencesErrors = $derived(this._preferencesErrors);
  isPreferencesSubmitting = $derived(this._isPreferencesSubmitting);

  override async initialize(): Promise<void> {
    await super.initialize();
    this._loadUserData();
    this._loadPreferences();
  }

  private _loadUserData(): void {
    const user = authService.currentUser;
    if (user) {
      this._profileForm.displayName = user.displayName || '';
      this._profileForm.email = user.email || '';
      this._profileForm.phoneNumber = user.phoneNumber || '';
    }
  }

  private _loadPreferences(): void {
    const savedTheme = (localStorage.getItem('theme') as 'system' | 'light' | 'dark') || 'system';
    const savedLanguage = (localStorage.getItem('language') as 'en' | 'es' | 'fr') || 'en';
    const savedNotifications = localStorage.getItem('notifications') !== 'false';

    this._preferencesForm.theme = savedTheme;
    this._preferencesForm.language = savedLanguage;
    this._preferencesForm.notifications = savedNotifications;
  }

  updateProfileField(key: keyof ProfileFormData, value: string): void {
    this._profileForm[key] = value as never;

    if (this._profileErrors[key]) {
      this._profileErrors[key] = undefined;
    }
  }

  updatePreferencesField(key: keyof PreferencesFormData, value: string | boolean): void {
    this._preferencesForm[key] = value as never;

    if (this._preferencesErrors[key]) {
      this._preferencesErrors[key] = undefined;
    }
  }

  private async _validateProfile(): Promise<boolean> {
    // TODO: Add TypeBox runtime validation when available
    // Basic structural check
    const form = this._profileForm;
    if (!form.displayName || !form.email) {
      this._profileErrors = {
        displayName: !form.displayName ? 'Required' : undefined,
        email: !form.email ? 'Required' : undefined,
      };
      return false;
    }
    this._profileErrors = {};
    return true;
  }

  private async _validatePreferences(): Promise<boolean> {
    // TODO: Add TypeBox runtime validation when available
    this._preferencesErrors = {};
    return true;
  }

  async saveProfile(): Promise<void> {
    if (this._isProfileSubmitting) {
      return;
    }

    if (!(await this._validateProfile())) {
      return;
    }

    this._isProfileSubmitting = true;
    this.debug('Saving profile', this._profileForm);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      dialogService.showSnackbar({
        text: 'Profile updated successfully!',
        type: 'success',
      });
    } catch (err) {
      this.error('Failed to save profile', err);
      dialogService.showSnackbar({
        text: 'Failed to update profile. Please try again.',
        type: 'error',
      });
    } finally {
      this._isProfileSubmitting = false;
    }
  }

  async savePreferences(): Promise<void> {
    if (this._isPreferencesSubmitting) {
      return;
    }

    if (!(await this._validatePreferences())) {
      return;
    }

    this._isPreferencesSubmitting = true;
    this.debug('Saving preferences', this._preferencesForm);

    try {
      localStorage.setItem('theme', this._preferencesForm.theme);
      localStorage.setItem('language', this._preferencesForm.language);
      localStorage.setItem('notifications', this._preferencesForm.notifications.toString());

      this._applyTheme(this._preferencesForm.theme);

      dialogService.showSnackbar({
        text: 'Preferences updated successfully!',
        type: 'success',
      });
    } catch (err) {
      this.error('Failed to save preferences', err);
      dialogService.showSnackbar({
        text: 'Failed to update preferences. Please try again.',
        type: 'error',
      });
    } finally {
      this._isPreferencesSubmitting = false;
    }
  }

  private _applyTheme(theme: 'system' | 'light' | 'dark'): void {
    const html = document.documentElement;

    if (theme === 'system') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', theme);
    }
  }

  async logout(): Promise<void> {
    try {
      await authService.signOut();
      await routerService.goToRoute('login', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (err) {
      this.error('Failed to logout', err);
      await dialogService.showSnackbar({
        text: 'Failed to logout. Please try again.',
        type: 'error',
      });
    }
  }

  async deleteAccount(): Promise<void> {
    const confirmed = await dialogService.openConfirmDialog({
      title: 'Delete Account',
      message: 'Are you sure you want to delete your account? This action cannot be undone.',
      agreeLabel: 'Delete Account',
      disagreeLabel: 'Cancel',
      agreeColor: 'danger',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.setAppLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await dialogService.showSnackbar({
        text: 'Account deleted successfully',
        type: 'success',
      });

      await routerService.goToRoute('login', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (err) {
      this.error('Failed to delete account', err);
      await dialogService.showSnackbar({
        text: 'Failed to delete account. Please try again.',
        type: 'error',
      });
    } finally {
      this.setAppLoading(false);
    }
  }
}

export const getSettingsViewModel = (
  options: SettingsViewModelOptions,
): SettingsViewModelInterface => new SettingsViewModel(options);
