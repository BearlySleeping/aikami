<script lang="ts">
  // apps/frontend/client/src/lib/views/settings/settings_view.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { SettingsViewModelInterface } from './settings_view_model.svelte.ts';
  import AiProvidersTab from './tabs/ai_providers_tab.svelte';
  import InstructTemplatesTab from './tabs/instruct_templates_tab.svelte';

  type Props = {
    viewModel: SettingsViewModelInterface;
  };
  const { viewModel }: Props = $props();

  type SettingsTab = 'profile' | 'providers' | 'instruct';
  let activeTab = $state<SettingsTab>('profile');

  const tabEntries: Array<{ id: SettingsTab; label: string }> = [
    { id: 'profile', label: t.settings() },
    { id: 'providers', label: 'AI Providers' },
    { id: 'instruct', label: 'Instruct' },
  ];
</script>

<BaseViewModelContainer {viewModel} class="container mx-auto p-6 max-w-4xl">
  {#if viewModel.errorMessage}
    <div class="alert alert-error mb-8"><span>{viewModel.errorMessage}</span></div>
  {/if}
  <div class="mb-8">
    <h1 class="text-3xl font-bold">{t.settings()}</h1>
    <p class="text-base-content/60 mt-2">{t.settings_description()}</p>
  </div>

  <!-- Tab Navigation -->
  <div class="tabs tabs-box bg-base-200 mb-8">
    {#each tabEntries as tab}
      <button
        class="tab"
        class:tab-active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab: Profile & Preferences -->
  {#if activeTab === 'profile'}
    <div class="grid gap-8 lg:grid-cols-2">
      <!-- Profile Settings -->
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body">
          <h2 class="card-title text-xl mb-4">{t.profile_information()}</h2>

          <form
            class="space-y-4"
            onsubmit={(e) => {
                          e.preventDefault();
                          viewModel.saveProfile();
                      }}
          >
            <div class="form-control">
              <label class="label" for="profile-name">
                <span class="label-text">{t.full_name()}</span>
              </label>
              <input
                id="profile-name"
                type="text"
                class="input input-bordered w-full"
                class:input-error={viewModel.profileErrors.displayName}
                value={viewModel.profileForm.displayName}
                oninput={(e) =>
                                  viewModel.updateProfileField(
                                      "displayName",
                                      e.currentTarget.value,
                                  )}
                disabled={viewModel.isProfileSubmitting}
                required
              >
              {#if viewModel.profileErrors.displayName}
                <div class="label">
                  <span class="label-text-alt text-error">
                    {viewModel.profileErrors.displayName}
                  </span>
                </div>
              {/if}
            </div>

            <div class="form-control">
              <label class="label" for="profile-email">
                <span class="label-text">{t.email()}</span>
              </label>
              <input
                id="profile-email"
                type="email"
                class="input input-bordered w-full"
                class:input-error={viewModel.profileErrors.email}
                value={viewModel.profileForm.email}
                oninput={(e) =>
                                  viewModel.updateProfileField(
                                      "email",
                                      e.currentTarget.value,
                                  )}
                disabled={viewModel.isProfileSubmitting}
                required
              >
              {#if viewModel.profileErrors.email}
                <div class="label">
                  <span class="label-text-alt text-error"> {viewModel.profileErrors.email} </span>
                </div>
              {/if}
            </div>

            <div class="form-control">
              <label class="label" for="profile-phone">
                <span class="label-text">
                  {t.phone_number()}
                  <span class="opacity-50">(optional)</span>
                </span>
              </label>
              <input
                id="profile-phone"
                type="tel"
                class="input input-bordered w-full"
                class:input-error={viewModel.profileErrors.phoneNumber}
                value={viewModel.profileForm.phoneNumber}
                oninput={(e) =>
                                  viewModel.updateProfileField(
                                      "phoneNumber",
                                      e.currentTarget.value,
                                  )}
                disabled={viewModel.isProfileSubmitting}
                autocomplete="tel"
              >
              {#if viewModel.profileErrors.phoneNumber}
                <div class="label">
                  <span class="label-text-alt text-error">
                    {viewModel.profileErrors.phoneNumber}
                  </span>
                </div>
              {/if}
            </div>

            <button type="submit" class="btn btn-primary" disabled={viewModel.isProfileSubmitting}>
              {#if viewModel.isProfileSubmitting}
                <span class="loading loading-spinner loading-sm"></span>
              {/if}
              {t.save_profile()}
            </button>
          </form>
        </div>
      </div>

      <!-- App Preferences -->
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body">
          <h2 class="card-title text-xl mb-4">{t.preferences()}</h2>

          <form
            class="space-y-4"
            onsubmit={(e) => {
                          e.preventDefault();
                          viewModel.savePreferences();
                      }}
          >
            <div class="form-control">
              <label class="label" for="theme-select">
                <span class="label-text">{t.theme()}</span>
              </label>
              <select
                id="theme-select"
                class="select select-bordered w-full"
                class:select-error={viewModel.preferencesErrors.theme}
                value={viewModel.preferencesForm.theme}
                onchange={(e) =>
                                  viewModel.updatePreferencesField(
                                      "theme",
                                      e.currentTarget.value,
                                  )}
                disabled={viewModel.isPreferencesSubmitting}
              >
                <option value="system">{t.theme_system()}</option>
                <option value="light">{t.theme_light()}</option>
                <option value="dark">{t.theme_dark()}</option>
              </select>
              {#if viewModel.preferencesErrors.theme}
                <div class="label">
                  <span class="label-text-alt text-error">
                    {viewModel.preferencesErrors.theme}
                  </span>
                </div>
              {/if}
            </div>

            <div class="form-control">
              <label class="label" for="language-select">
                <span class="label-text">{t.language()}</span>
              </label>
              <select
                id="language-select"
                class="select select-bordered w-full"
                class:select-error={viewModel.preferencesErrors.language}
                value={viewModel.preferencesForm.language}
                onchange={(e) =>
                                  viewModel.updatePreferencesField(
                                      "language",
                                      e.currentTarget.value,
                                  )}
                disabled={viewModel.isPreferencesSubmitting}
              >
                <option value="en">{t.language_english()}</option>
                <option value="es">{t.language_spanish()}</option>
                <option value="fr">{t.language_french()}</option>
              </select>
              {#if viewModel.preferencesErrors.language}
                <div class="label">
                  <span class="label-text-alt text-error">
                    {viewModel.preferencesErrors.language}
                  </span>
                </div>
              {/if}
            </div>

            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text"> {t.enable_notifications()} </span>
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  checked={viewModel.preferencesForm.notifications}
                  onchange={(e) =>
                                      viewModel.updatePreferencesField(
                                          "notifications",
                                          e.currentTarget.checked,
                                      )}
                  disabled={viewModel.isPreferencesSubmitting}
                >
              </label>
              {#if viewModel.preferencesErrors.notifications}
                <div class="label">
                  <span class="label-text-alt text-error">
                    {viewModel.preferencesErrors.notifications}
                  </span>
                </div>
              {/if}
            </div>

            <button
              type="submit"
              class="btn btn-primary"
              disabled={viewModel.isPreferencesSubmitting}
            >
              {#if viewModel.isPreferencesSubmitting}
                <span class="loading loading-spinner loading-sm"></span>
              {/if}
              {t.save_preferences()}
            </button>
          </form>
        </div>
      </div>
    </div>
  {/if}

  <!-- Tab: AI Providers -->
  {#if activeTab === 'providers'}
    <AiProvidersTab />
  {/if}

  <!-- Tab: Instruct Templates -->
  {#if activeTab === 'instruct'}
    <InstructTemplatesTab />
  {/if}

  <!-- Danger Zone -->
  <div class="card bg-base-100 shadow-xl mt-8">
    <div class="card-body">
      <h2 class="card-title text-xl text-error mb-4">{t.danger_zone()}</h2>
      <p class="text-base-content/60 mb-4">{t.danger_zone_description()}</p>

      <div class="divider"></div>

      <div class="flex flex-col sm:flex-row gap-4">
        <button
          class="btn btn-outline btn-error"
          onclick={() => viewModel.deleteAccount()}
          disabled={viewModel.showLoadingView}
        >
          {t.delete_account()}
        </button>
        <button
          class="btn btn-outline"
          onclick={() => viewModel.logout()}
          disabled={viewModel.showLoadingView}
        >
          {t.logout()}
        </button>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
