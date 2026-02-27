import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { CoreFormSchema } from '@aikami/schemas';
import { z } from 'zod';
import { authService, dialogService, routerService } from '$services/index.ts';

const ProfileFormSchema = CoreFormSchema.extend({
  displayName: z.string().min(1, 'Name is required'),
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  phoneNumber: z.string().optional(),
});

const PreferencesFormSchema = CoreFormSchema.extend({
  theme: z.enum(['system', 'light', 'dark']),
  language: z.enum(['en', 'es', 'fr']),
  notifications: z.boolean(),
});

export type SettingsViewModelOptions = BaseViewModelOptions;

export type SettingsViewModelInterface = BaseViewModelInterface & {
  /**
   * The profile form data.
   */
  readonly profileForm: z.infer<typeof ProfileFormSchema>;

  /**
   * The errors for the profile form.
   */
  readonly profileErrors: Partial<Record<keyof z.infer<typeof ProfileFormSchema>, string>>;

  /**
   * Whether the profile form is submitting.
   */
  readonly isProfileSubmitting: boolean;

  /**
   * The preferences form data.
   */
  readonly preferencesForm: z.infer<typeof PreferencesFormSchema>;

  /**
   * The errors for the preferences form.
   */
  readonly preferencesErrors: Partial<Record<keyof z.infer<typeof PreferencesFormSchema>, string>>;

  /**
   * Whether the preferences form is submitting.
   */
  readonly isPreferencesSubmitting: boolean;

  /**
   * Updates a field in the profile form.
   * @param key The key of the field to update.
   * @param value The new value of the field.
   */
  updateProfileField(key: keyof z.infer<typeof ProfileFormSchema>, value: string): void;

  /**
   * Updates a field in the preferences form.
   * @param key The key of the field to update.
   * @param value The new value of the field.
   */
  updatePreferencesField(
    key: keyof z.infer<typeof PreferencesFormSchema>,
    value: string | boolean,
  ): void;

  /**
   * Saves the profile.
   */
  saveProfile(): Promise<void>;

  /**
   * Saves the preferences.
   */
  savePreferences(): Promise<void>;

  /**
   * Logs out the current user.
   */
  logout(): Promise<void>;

  /**
   * Deletes the current user's account.
   */
  deleteAccount(): Promise<void>;
};

class SettingsViewModel
  extends BaseViewModel<SettingsViewModelOptions>
  implements SettingsViewModelInterface
{
  /**
   * The profile form state.
   */
  private _profileForm = $state<z.infer<typeof ProfileFormSchema>>({
    displayName: '',
    email: '',
    phoneNumber: '',
  });

  /**
   * The errors for the profile form.
   */
  private _profileErrors = $state<Partial<Record<keyof z.infer<typeof ProfileFormSchema>, string>>>(
    {},
  );

  /**
   * Whether the profile form is submitting.
   */
  private _isProfileSubmitting = $state(false);

  /**
   * The preferences form state.
   */
  private _preferencesForm = $state<z.infer<typeof PreferencesFormSchema>>({
    theme: 'system',
    language: 'en',
    notifications: true,
  });

  /**
   * The errors for the preferences form.
   */
  private _preferencesErrors = $state<
    Partial<Record<keyof z.infer<typeof PreferencesFormSchema>, string>>
  >({});

  /**
   * Whether the preferences form is submitting.
   */
  private _isPreferencesSubmitting = $state(false);

  // Getters
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

  /**
   * Loads user data into the profile form.
   */
  private _loadUserData(): void {
    const user = authService.currentUser;
    if (user) {
      this._profileForm.displayName = user.displayName || '';
      this._profileForm.email = user.email || '';
      this._profileForm.phoneNumber = user.phoneNumber || '';
    }
  }

  /**
   * Loads user preferences from storage.
   */
  private _loadPreferences(): void {
    // In a real app, you'd load these from a user preferences service or localStorage
    const savedTheme = (localStorage.getItem('theme') as 'system' | 'light' | 'dark') || 'system';
    const savedLanguage = (localStorage.getItem('language') as 'en' | 'es' | 'fr') || 'en';
    const savedNotifications = localStorage.getItem('notifications') !== 'false';

    this._preferencesForm.theme = savedTheme;
    this._preferencesForm.language = savedLanguage;
    this._preferencesForm.notifications = savedNotifications;
  }

  updateProfileField(key: keyof z.infer<typeof ProfileFormSchema>, value: string): void {
    this._profileForm[key] = value;

    // Clear error for this field
    if (this._profileErrors[key]) {
      this._profileErrors[key] = undefined;
    }
  }

  updatePreferencesField(
    key: keyof z.infer<typeof PreferencesFormSchema>,
    value: string | boolean,
  ): void {
    // TODO: implement a better validation than casting to never
    this._preferencesForm[key] = value as never;

    // Clear error for this field
    if (this._preferencesErrors[key]) {
      this._preferencesErrors[key] = undefined;
    }
  }

  private async _validateProfile(): Promise<boolean> {
    const result = await ProfileFormSchema.safeParseAsync(this._profileForm);

    if (result.success) {
      this._profileErrors = {};
      return true;
    }

    const errors: Partial<Record<keyof z.infer<typeof ProfileFormSchema>, string>> = {};
    result.error.issues.forEach((issue) => {
      const path = issue.path[0] as keyof z.infer<typeof ProfileFormSchema>;
      errors[path] = issue.message;
    });

    this._profileErrors = errors;
    return false;
  }

  private async _validatePreferences(): Promise<boolean> {
    const result = await PreferencesFormSchema.safeParseAsync(this._preferencesForm);

    if (result.success) {
      this._preferencesErrors = {};
      return true;
    }

    const errors: Partial<Record<keyof z.infer<typeof PreferencesFormSchema>, string>> = {};
    result.error.issues.forEach((issue) => {
      const path = issue.path[0] as keyof z.infer<typeof PreferencesFormSchema>;
      errors[path] = issue.message;
    });

    this._preferencesErrors = errors;
    return false;
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
      // In a real app, you'd call an API to update the user profile
      // For now, we'll simulate the API call
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
      // Save preferences to localStorage (in a real app, you'd save to a backend)
      localStorage.setItem('theme', this._preferencesForm.theme);
      localStorage.setItem('language', this._preferencesForm.language);
      localStorage.setItem('notifications', this._preferencesForm.notifications.toString());

      // Apply theme immediately
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

      // In a real app, you'd call an API to delete the account
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
