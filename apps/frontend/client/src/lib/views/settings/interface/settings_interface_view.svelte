<script lang="ts">
// apps/frontend/client/src/lib/views/settings/interface/settings_interface_view.svelte
//
// C-528 — Settings > Interface. Preset selection, per-widget visibility,
// placement, density and scale, the temporary Hide HUD toggle, and the preset
// exchange controls. Everything here writes through the ONE HUD authority.
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { SettingsInterfaceViewModelInterface } from './settings_interface_view_model.svelte';

type Props = {
  viewModel: SettingsInterfaceViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="space-y-6" data-testid="settings-interface">
    <!-- Recovery notice: shown when the stored layout could not be read. -->
    {#if viewModel.recoveryNotice}
      <div class="alert alert-warning" role="status" data-testid="hud-recovery-notice">
        <span>{viewModel.recoveryNotice}</span>
        <button type="button" class="btn btn-sm" onclick={() => viewModel.restoreDefaults()}>
          Restore default interface
        </button>
      </div>
    {/if}

    {#if viewModel.statusMessage}
      <div class="alert alert-success" role="status" data-testid="hud-status">
        <span>{viewModel.statusMessage}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => viewModel.dismissStatus()}
        >
          Dismiss
        </button>
      </div>
    {/if}

    {#if viewModel.importErrorMessage}
      <div class="alert alert-error" role="alert" data-testid="hud-import-error">
        <span>{viewModel.importErrorMessage}</span>
      </div>
    {/if}

    <!-- C-529 Appearance — a sub-view of this section, not a new section id,
         so `?section=interface` stays the one deep link into it. -->
    <div class="card bg-base-100 shadow" data-testid="settings-appearance">
      <div class="card-body">
        <h2 class="card-title">Appearance</h2>
        <p class="text-base-content/60">
          Appearance mode and theme are independent of your HUD layout and accessibility settings. A
          theme changes colours, type and corners — never gameplay, positions or controls.
        </p>
        <div class="divider"></div>

        {#if viewModel.appearanceRecoveryNotice}
          <div class="alert alert-warning" role="status" data-testid="appearance-recovery-notice">
            <span>{viewModel.appearanceRecoveryNotice}</span>
            <button
              type="button"
              class="btn btn-sm"
              data-testid="appearance-restore-defaults"
              onclick={() => viewModel.restoreDefaultAppearance()}
            >
              Restore default appearance
            </button>
          </div>
        {/if}

        <fieldset class="space-y-2">
          <legend class="label-text font-semibold">Mode</legend>
          <div class="flex flex-wrap gap-2">
            {#each viewModel.appearanceModeOptions as option}
              <label
                class="btn btn-outline btn-sm justify-start"
                class:btn-active={viewModel.appearanceMode === option.id}
                data-testid="appearance-mode-{option.id}"
              >
                <input
                  type="radio"
                  class="radio radio-sm"
                  name="appearance-mode"
                  value={option.id}
                  checked={viewModel.appearanceMode === option.id}
                  onchange={() => viewModel.setAppearanceMode(option.id)}
                >
                <span>{option.label}</span>
              </label>
            {/each}
          </div>
          <p class="text-xs text-base-content/60" data-testid="appearance-resolved-variant">
            Rendering: {viewModel.appearanceVariant}
          </p>
        </fieldset>

        <fieldset class="mt-4 space-y-2">
          <legend class="label-text font-semibold">Theme</legend>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each viewModel.appearanceThemeOptions as theme (theme.id)}
              <label
                class="btn btn-outline justify-start text-left"
                class:btn-active={viewModel.appearanceThemeId === theme.id}
                data-testid="appearance-theme-{theme.id}"
              >
                <input
                  type="radio"
                  class="radio radio-sm"
                  name="appearance-theme"
                  value={theme.id}
                  checked={viewModel.appearanceThemeId === theme.id}
                  onchange={() => viewModel.selectAppearanceTheme(theme.id)}
                >
                <span class="flex flex-col items-start">
                  <span class="font-semibold">{theme.name}</span>
                  <span class="text-xs opacity-70">
                    {theme.isBuiltIn ? 'Built-in' : 'Installed'}
                    · v{theme.version}
                  </span>
                </span>
              </label>
            {/each}
          </div>
          {#if viewModel.isUsingBuiltinFallbackVariant}
            <p class="text-xs text-base-content/60" data-testid="appearance-variant-fallback">
              This theme does not define the {viewModel.appearanceVariant} variant, so the built-in
              {viewModel.appearanceVariant}
              palette is used while the theme stays selected.
            </p>
          {/if}
        </fieldset>

        <div class="mt-4">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="appearance-reset"
            onclick={() => viewModel.restoreDefaultAppearance()}
          >
            Restore default appearance
          </button>
        </div>
      </div>
    </div>

    <!-- Presets -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">HUD preset</h2>
        <p class="text-base-content/60">
          A preset sets the whole layout at once. You can still adjust individual widgets below.
        </p>
        <div class="divider"></div>

        <div class="grid gap-2 sm:grid-cols-2">
          {#each viewModel.presetOptions as preset}
            <label
              class="btn btn-outline justify-start text-left"
              class:btn-active={viewModel.selectedPresetId === preset.id}
              data-testid="hud-preset-{preset.id}"
            >
              <input
                type="radio"
                class="radio radio-sm"
                name="hud-preset"
                value={preset.id}
                checked={viewModel.selectedPresetId === preset.id}
                onchange={() => viewModel.selectPreset(preset.id)}
              >
              <span class="flex flex-col items-start">
                <span class="font-semibold">{preset.label}</span>
                <span class="text-xs opacity-70">{preset.description}</span>
              </span>
            </label>
          {/each}
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="hud-restore-defaults"
            onclick={() => viewModel.restoreDefaults()}
          >
            Restore default interface
          </button>
          <label class="label cursor-pointer gap-2">
            <span class="label-text">Hide HUD temporarily</span>
            <input
              type="checkbox"
              class="toggle toggle-sm"
              data-testid="hud-hide-toggle"
              checked={viewModel.isHudTemporarilyHidden}
              onchange={(event) =>
                viewModel.setHudTemporarilyHidden(event.currentTarget.checked)}
            >
          </label>
        </div>
      </div>
    </div>

    <!-- Per-widget controls -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Widgets</h2>
        <p class="text-base-content/60">
          Menu and system notices are required and always stay reachable.
        </p>
        <div class="divider"></div>

        {#if !viewModel.isEditorEnabled}
          <div class="alert alert-warning" role="status" data-testid="hud-controls-unavailable">
            HUD customization is unavailable in this build. Your saved layout is preserved.
          </div>
        {/if}

        <ul class="space-y-4" data-testid="hud-widget-list">
          {#each viewModel.widgetRows as row (row.widgetId)}
            <li
              class="rounded-lg border border-base-300 p-3"
              data-testid="hud-widget-row-{row.widgetId}"
            >
              <div class="flex items-center justify-between gap-2">
                <div>
                  <p class="font-semibold">{row.label}</p>
                  <p class="text-xs text-base-content/60">{row.description}</p>
                </div>
                <div class="flex items-center gap-2">
                  {#if row.required}
                    <span class="badge badge-sm" data-testid="hud-widget-required-{row.widgetId}">
                      Required
                    </span>
                  {/if}
                  {#if row.dormant}
                    <span class="badge badge-sm badge-warning">Unavailable</span>
                  {/if}
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    data-testid="hud-widget-reset-{row.widgetId}"
                    disabled={!viewModel.isEditorEnabled}
                    onclick={() => viewModel.resetWidget(row.widgetId)}
                  >
                    Reset
                  </button>
                </div>
              </div>

              {#if viewModel.isEditorEnabled}
                <div class="mt-3 grid gap-3 sm:grid-cols-3">
                  <label class="form-control">
                    <span class="label-text">Visibility</span>
                    <select
                      class="select select-bordered select-sm"
                      data-testid="hud-widget-visibility-{row.widgetId}"
                      disabled={row.required}
                      value={row.visibility}
                      onchange={(event) =>
                      viewModel.setVisibility(
                        row.widgetId,
                        event.currentTarget.value as typeof row.visibility,
                      )}
                    >
                      {#each row.visibilityOptions as option}
                        <option value={option.id}>{option.label}</option>
                      {/each}
                    </select>
                  </label>

                  <label class="form-control">
                    <span class="label-text">Placement</span>
                    <select
                      class="select select-bordered select-sm"
                      data-testid="hud-widget-anchor-{row.widgetId}"
                      value={row.anchor}
                      onchange={(event) =>
                      viewModel.setAnchor(row.widgetId, event.currentTarget.value as typeof row.anchor)}
                    >
                      {#each row.allowedAnchors as anchor}
                        <option value={anchor}>{anchor}</option>
                      {/each}
                    </select>
                  </label>

                  <label class="form-control">
                    <span class="label-text">Density</span>
                    <select
                      class="select select-bordered select-sm"
                      data-testid="hud-widget-density-{row.widgetId}"
                      value={row.density}
                      onchange={(event) =>
                      viewModel.setDensity(
                        row.widgetId,
                        event.currentTarget.value as typeof row.density,
                      )}
                    >
                      {#each row.densityOptions as option}
                        <option value={option.id}>{option.label}</option>
                      {/each}
                    </select>
                  </label>
                </div>

                <label class="form-control mt-3">
                  <span class="label-text"> Scale: {Math.round(row.scale * 100)}% </span>
                  <input
                    type="range"
                    class="range range-sm"
                    min="80"
                    max="150"
                    step="5"
                    value={Math.round(row.scale * 100)}
                    data-testid="hud-widget-scale-{row.widgetId}"
                    onchange={(event) =>
                      viewModel.setScale(row.widgetId, Number(event.currentTarget.value) / 100)}
                  >
                </label>
              {/if}
            </li>
          {/each}
        </ul>

        {#if viewModel.dormantWidgetIds.length > 0}
          <p class="mt-4 text-xs text-base-content/60" data-testid="hud-dormant-list">
            Saved choices for widgets this build does not have are kept and will return if the
            widget does: {viewModel.dormantWidgetIds.join(', ')}
          </p>
        {/if}
      </div>
    </div>

    <!-- Preset exchange (schema reused by C-529/C-530) -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Share a layout</h2>
        <p class="text-base-content/60">
          Exports contain only widget placement and visibility — never accessibility settings,
          device details or campaign content.
        </p>
        <div class="divider"></div>

        <button
          type="button"
          class="btn btn-sm btn-outline"
          data-testid="hud-export-preset"
          onclick={() => viewModel.exportPreset()}
        >
          Export layout
        </button>

        {#if viewModel.exportedPresetJson}
          <textarea
            class="textarea textarea-bordered mt-3 h-40 w-full font-mono text-xs"
            readonly
            data-testid="hud-export-output"
            value={viewModel.exportedPresetJson}
          ></textarea>
        {/if}

        <label class="form-control mt-4">
          <span class="label-text">Import a layout</span>
          <textarea
            class="textarea textarea-bordered h-24 w-full font-mono text-xs"
            placeholder="Paste a preset JSON"
            data-testid="hud-import-input"
            value={viewModel.importDraft}
            oninput={(event) => viewModel.handleImportInput(event)}
          ></textarea>
        </label>
        <button
          type="button"
          class="btn btn-sm btn-outline mt-2"
          data-testid="hud-import-apply"
          onclick={() => viewModel.importPresetJson(viewModel.importDraft)}
        >
          Import layout
        </button>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
