<script lang="ts">
// apps/frontend/client/src/lib/views/settings/interface/settings_interface_view.svelte
//
// C-528 — Settings > Interface. Preset selection, per-widget visibility,
// placement, density and scale, the temporary Hide HUD toggle, and the preset
// exchange controls. Everything here writes through the ONE HUD authority.
import { Image } from '$components';
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

        <!-- Recovery first: "Restore default appearance" must be reachable
             without hunting through the card, and it works even when the stored
             selection is unreadable. -->
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="appearance-reset"
            onclick={() => viewModel.restoreDefaultAppearance()}
          >
            Restore default appearance
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="appearance-open-editor"
            onclick={() => viewModel.openEditor()}
          >
            Create a theme
          </button>
        </div>

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

        <fieldset class="mt-4 space-y-2" data-testid="appearance-accessibility">
          <legend class="label-text font-semibold">Accessibility appearance</legend>
          <p class="text-xs text-base-content/60">
            These always win over a theme's own choices, and what they change is listed below.
          </p>
          <label class="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              class="toggle toggle-sm"
              data-testid="appearance-high-contrast"
              checked={viewModel.isHighContrast}
              onchange={(event) => viewModel.setHighContrast(event.currentTarget.checked)}
            >
            <span class="label-text">High contrast text and focus</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              class="toggle toggle-sm"
              data-testid="appearance-opaque-surfaces"
              checked={viewModel.hasOpaqueSurfaces}
              onchange={(event) => viewModel.setOpaqueSurfaces(event.currentTarget.checked)}
            >
            <span class="label-text">Opaque surfaces</span>
          </label>
          {#if viewModel.accessibilityChangeSummary.length > 0}
            <p class="text-xs text-base-content/60" data-testid="appearance-change-summary">
              Changed: {viewModel.accessibilityChangeSummary.join(', ')}
            </p>
          {/if}
        </fieldset>
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

    <!-- C-529 AC-3: local package export/import. Staging is separate from
         applying so a package can be inspected and still walked away from. -->
    <div class="card bg-base-100 shadow" data-testid="theme-package-exchange">
      <div class="card-body">
        <h2 class="card-title">Share or install a theme</h2>
        <p class="text-base-content/60">
          Exports contain only the theme's token data and declared assets — never your preferences,
          your saves, your device details or a screenshot.
        </p>
        <div class="divider"></div>

        {#if viewModel.packageMessage}
          <div class="alert alert-success" role="status" data-testid="theme-package-message">
            <span>{viewModel.packageMessage}</span>
          </div>
        {/if}

        {#if viewModel.packageFailures.length > 0}
          <ul class="alert alert-error" role="alert" data-testid="theme-package-errors">
            {#each viewModel.packageFailures as failure}
              <li>
                <span class="font-mono text-xs">{failure.code}</span>
                {failure.message}
                {#if failure.subject}
                  <span class="opacity-70">({failure.subject})</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="theme-export"
            disabled={viewModel.isThemeExportDisabled}
            onclick={() => {
              void viewModel.exportThemePackage();
            }}
          >
            Export theme package
          </button>

          <label class="btn btn-sm btn-outline">
            Import theme package
            <input
              type="file"
              class="sr-only"
              accept=".zip,application/zip"
              data-testid="theme-import-input"
              onchange={(event) => {
                void viewModel.handleThemePackageFile(event);
              }}
            >
          </label>

          {#if viewModel.stagedPackage}
            <button
              type="button"
              class="btn btn-sm btn-primary"
              data-testid="theme-apply-staged"
              onclick={() => viewModel.applyStagedPackage()}
            >
              Apply staged theme
            </button>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              data-testid="theme-cancel-staged"
              onclick={() => viewModel.cancelStagedPackage()}
            >
              Cancel
            </button>
          {/if}
        </div>

        {#if viewModel.stagedPackage}
          <p class="mt-3 text-xs text-base-content/60" data-testid="theme-staged-summary">
            Staged {viewModel.stagedPackage.installation.manifest.name} v{viewModel.stagedPackage
              .installation.manifest.version}
            — {viewModel.stagedPackage.fileNames.length} files, not applied yet.
          </p>
          {#if viewModel.stagedPackage.previewUrl}
            <Image
              src={viewModel.stagedPackage.previewUrl}
              alt="Theme preview"
              class="mt-2 max-h-48 rounded-box border border-base-300"
              data-testid="theme-staged-preview"
            />
          {/if}
        {/if}

        {#if viewModel.canUninstallTheme}
          <button
            type="button"
            class="btn btn-sm btn-ghost mt-3"
            data-testid="theme-uninstall"
            onclick={() => viewModel.uninstallTheme()}
          >
            Uninstall installed theme
          </button>
        {/if}
      </div>
    </div>

    <!-- C-529 AC-2: the no-code creator editor. The friendly role editor and
         the advanced JSON editor both compile through the SAME validator the
         CLI and the runtime use, and the preview is inert fixture data. -->
    {#if viewModel.isEditorOpen}
      <div class="card bg-base-100 shadow" data-testid="theme-editor">
        <div class="card-body">
          <h2 class="card-title">Create a theme — {viewModel.editorName}</h2>
          <p class="text-base-content/60">
            Start from the built-in theme, adjust a role, and watch the four previews below. Nothing
            is applied until you press Apply.
          </p>
          <div class="divider"></div>

          <div class="flex flex-wrap gap-2">
            {#each ['light', 'dark'] as const as variant}
              <button
                type="button"
                class="btn btn-sm btn-outline"
                class:btn-active={viewModel.editorVariant === variant}
                data-testid="theme-editor-variant-{variant}"
                onclick={() => viewModel.selectEditorVariant(variant)}
              >
                {variant}
              </button>
            {/each}
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              data-testid="theme-editor-reset"
              onclick={() => viewModel.resetEditorToBuiltIn()}
            >
              Reset to built-in
            </button>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              data-testid="theme-editor-close"
              onclick={() => viewModel.closeEditor()}
            >
              Cancel
            </button>
          </div>

          <div class="mt-4">
            <p class="label-text font-semibold">Starter presets</p>
            <div class="flex flex-wrap gap-2">
              {#each viewModel.starterPresets as preset (preset.id)}
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  title={preset.description}
                  data-testid="theme-editor-preset-{preset.id}"
                  onclick={() => viewModel.applyEditorPreset(preset.id)}
                >
                  {preset.label}
                </button>
              {/each}
            </div>
          </div>

          {#if viewModel.editorIssues.length > 0}
            <ul class="alert alert-error mt-4" role="alert" data-testid="theme-editor-issues">
              {#each viewModel.editorIssues as issue}
                <li>
                  <span class="font-mono text-xs">{issue.code}</span>
                  {issue.message}
                </li>
              {/each}
            </ul>
          {/if}

          {#each viewModel.editorRoleGroups as group (group.id)}
            <div class="mt-4" data-testid="theme-editor-group-{group.id}">
              <p class="label-text font-semibold capitalize">{group.id}</p>
              <div class="grid gap-2 sm:grid-cols-2">
                {#each group.rows as row (row.tokenId)}
                  {#if row.options}
                    <label class="form-control">
                      <span class="label-text text-xs">{row.label}</span>
                      <select
                        class="select select-bordered select-sm"
                        data-testid="theme-editor-role-{row.tokenId}"
                        value={row.rawValue}
                        onchange={(event) =>
                          viewModel.setEditorRoleValue(row.tokenId, event.currentTarget.value)}
                      >
                        {#each row.options as option}
                          <option value={option}>{option}</option>
                        {/each}
                      </select>
                    </label>
                  {:else}
                    <label class="form-control">
                      <span class="label-text text-xs">{row.label}</span>
                      <input
                        type="text"
                        class="input input-bordered input-sm font-mono text-xs"
                        data-testid="theme-editor-role-{row.tokenId}"
                        value={row.rawValue}
                        onchange={(event) =>
                          viewModel.setEditorRoleValue(row.tokenId, event.currentTarget.value)}
                      >
                    </label>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}

          <label class="form-control mt-4">
            <span class="label-text">Advanced JSON ({viewModel.editorVariant} variant)</span>
            <textarea
              class="textarea textarea-bordered h-40 w-full font-mono text-xs"
              data-testid="theme-editor-json"
              value={viewModel.editorJson}
              oninput={(event) => viewModel.handleEditorJsonInput(event)}
            ></textarea>
          </label>
          {#if viewModel.editorJsonIssues.length > 0}
            <ul class="alert alert-error mt-2" role="alert" data-testid="theme-editor-json-issues">
              {#each viewModel.editorJsonIssues as issue}
                <li>
                  <span class="font-mono text-xs">{issue.code}</span>
                  {issue.message}
                </li>
              {/each}
            </ul>
          {/if}
          <button
            type="button"
            class="btn btn-sm btn-outline mt-2"
            data-testid="theme-editor-json-apply"
            onclick={() => viewModel.applyEditorJson()}
          >
            Load JSON into the editor
          </button>

          <!-- The preview root is the ONLY element the draft repaints. Inline
               custom properties are inherited by its descendants and beat any
               stylesheet rule for that element, so the draft cannot leak into
               the trusted settings chrome around it. -->
          <div
            class="mt-6 rounded-box border border-base-300 p-3"
            data-testid="theme-editor-preview"
            data-aikami-theme-scope
            data-aikami-variant={viewModel.editorVariant}
            style={viewModel.editorPreviewStyle}
          >
            <p class="label-text font-semibold">Preview — four game contexts</p>
            <div class="mt-2 grid gap-3 lg:grid-cols-2">
              {#each viewModel.editorPreviewContexts as context (context.id)}
                <div
                  class="rounded-box border border-base-300 bg-base-100 p-3"
                  data-testid="theme-preview-{context.id}"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs uppercase tracking-wide text-muted-content">
                      {context.label}
                    </span>
                    <span class="badge badge-sm {viewModel.previewStatusBadgeClass(context)}">
                      {context.status.label}
                    </span>
                  </div>
                  <p class="mt-2 text-lg font-semibold leading-tight text-base-content">
                    {context.title}
                  </p>
                  <p class="mt-1 text-sm leading-relaxed text-base-content">{context.body}</p>
                  <p class="mt-3 text-xs text-muted-content">
                    {context.progress.label}
                    · {context.progress.percent}%
                  </p>
                  <div
                    class="mt-1 h-3 w-full overflow-hidden rounded-box border border-base-300 bg-base-200"
                  >
                    <div class="h-full bg-primary" style="width: {context.progress.percent}%"></div>
                  </div>
                  <div
                    class="mt-3 flex items-center justify-between gap-2 border-t border-base-300 pt-2"
                  >
                    <span class="text-sm text-base-content">{context.listRow.name}</span>
                    <span class="text-xs text-muted-content">{context.listRow.meta}</span>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-2 border-t border-base-300 pt-2">
                    {#each context.actions as action}
                      <span class="btn btn-xs btn-outline">{action}</span>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-sm btn-primary"
              data-testid="theme-editor-apply"
              disabled={!viewModel.editorIsValid}
              onclick={() => viewModel.applyEditorDraft()}
            >
              Apply
            </button>
            <span class="text-xs text-base-content/60 self-center">
              {viewModel.editorIsValid ? 'Valid' : 'Fix the highlighted role to apply'}
            </span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
