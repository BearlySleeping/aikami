<script lang="ts">
// apps/frontend/hub/src/lib/views/community/theme_detail_view.svelte
//
// One theme version's detail page (C-530 AC-3 / AC-4) — declared facts, the
// scoped fixture preview, the download/install handoff and the moderation
// status.
//
// 🔴 The preview is one element carrying `data-theme-preview` and the compiled
// `--ui-*` custom properties. The scope attribute is the whole isolation
// story: Hub navigation, auth and moderation chrome sit outside it and keep the
// Hub's trusted appearance, and nothing in the package can select into them.
// Logicless: every expression is a direct ViewModel member.
import { BaseViewModelContainer } from '$components';
import type { ThemeDetailViewModelInterface } from './theme_detail_view_model.svelte.ts';

type Props = { viewModel: ThemeDetailViewModelInterface };
const { viewModel }: Props = $props();

const previewModeClass = (mode: string): string => {
  switch (mode) {
    case 'high-contrast':
      return 'contrast-more';
    case 'compact':
      return 'text-xs';
    case 'large-text':
      return 'text-2xl';
    default:
      return 'text-base';
  }
};
</script>

<BaseViewModelContainer
  {viewModel}
  id="theme-detail"
  class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6"
>
  <nav aria-label="Breadcrumb" class="text-sm text-base-content/60">
    <a class="transition-colors hover:text-base-content" href="/catalog">Catalog</a>
    <span class="mx-2" aria-hidden="true">/</span>
    <a class="transition-colors hover:text-base-content" href="/community/themes">Themes</a>
    <span class="mx-2" aria-hidden="true">/</span>
    <span class="text-base-content">{viewModel.detail.name}</span>
  </nav>

  <header class="flex flex-col gap-2">
    <h1 class="font-display text-3xl text-base-content" data-testid="theme-detail-name">
      {viewModel.detail.name}
    </h1>
    <p class="font-mono text-sm text-base-content/70" data-testid="theme-detail-identity">
      {viewModel.detail.themeId}@{viewModel.detail.version}
    </p>
    <p class="text-sm text-base-content/70">
      By <span data-testid="theme-detail-author">{viewModel.detail.authorDisplayName}</span>
      · Licence <span data-testid="theme-detail-license">{viewModel.detail.license}</span>
      · <span data-testid="theme-detail-status">{viewModel.statusLabel}</span>
    </p>
  </header>

  {#if !viewModel.apiSupported}
    <p
      class="rounded-md border border-warning bg-warning/10 p-3 text-sm text-base-content"
      data-testid="theme-detail-incompatible"
    >
      This theme requires {viewModel.detail.themeApiRange}, which this client does not implement.
      It will not be applied.
    </p>
  {/if}

  {#if viewModel.revoked}
    <p
      class="rounded-md border border-error bg-error/10 p-3 text-sm text-base-content"
      data-testid="theme-detail-revoked"
    >
      This version was withdrawn from public distribution. If you already installed it, it keeps
      working offline; remove it from Settings → Interface → Appearance when you are connected.
    </p>
  {/if}

  <section class="flex flex-col gap-3" aria-labelledby="theme-preview-heading">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="theme-preview-heading" class="font-display text-xl text-base-content">
        Preview
      </h2>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Preview variant">
        {#each viewModel.detail.variants as variant (variant)}
          <button
            type="button"
            class="rounded-md border px-3 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary {viewModel.variant ===
            variant
              ? 'border-primary bg-primary/10 text-base-content'
              : 'border-base-300 text-base-content/70'}"
            aria-pressed={viewModel.variant === variant}
            onclick={() => viewModel.selectVariant(variant)}
            data-testid="theme-detail-variant-{variant}"
          >
            {variant}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex flex-wrap gap-2" role="group" aria-label="Preview context">
      {#each viewModel.previewModes as mode (mode)}
        <button
          type="button"
          class="rounded-md border px-3 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary {viewModel.previewMode ===
          mode
            ? 'border-primary bg-primary/10 text-base-content'
            : 'border-base-300 text-base-content/70'}"
          aria-pressed={viewModel.previewMode === mode}
          onclick={() => viewModel.selectPreviewMode(mode)}
          data-testid="theme-detail-mode-{mode}"
        >
          {mode === 'default' ? 'Default' : mode}
        </button>
      {/each}
    </div>

    <!-- Themed region: only this subtree carries the package's custom properties. -->
    <div
      data-theme-preview
      data-preview-mode={viewModel.previewMode}
      class="rounded-lg border border-base-300 p-4 {previewModeClass(viewModel.previewMode)}"
      style={viewModel.previewStyle}
      data-testid="theme-detail-preview"
    >
      <div
        class="mb-3 flex items-center justify-between gap-3 rounded-md px-3 py-2"
        style="background: var(--ui-color-panel, var(--ui-color-base-200)); color: var(--ui-color-base-content)"
      >
        <span class="font-display">Fixture Campaign</span>
        <span class="text-xs">HP 42 / 50</span>
      </div>
      <div class="flex flex-col gap-2">
        <p style="color: var(--ui-color-base-content)">
          A synthetic fixture renders here so you can judge the theme. It is not your campaign and
          it loads nothing from the network.
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-1 text-sm"
            style="background: var(--ui-color-primary, #6d5cff); color: var(--ui-color-primary-content, #ffffff)"
            data-testid="theme-detail-fixture-action"
          >
            Attack
          </button>
          <button
            type="button"
            class="rounded-md border px-3 py-1 text-sm"
            style="border-color: var(--ui-color-base-300); color: var(--ui-color-base-content)"
          >
            Defend
          </button>
        </div>
      </div>
    </div>
    <p class="text-[11px] text-base-content/50">
      Rendering context: {viewModel.previewModeLabel}. The Hub's own navigation and account
      controls are not themed.
    </p>
  </section>

  <section class="flex flex-col gap-2" aria-labelledby="theme-facts-heading">
    <h2 id="theme-facts-heading" class="font-display text-xl text-base-content">
      What this package declares
    </h2>
    <dl class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
      <div class="flex gap-2">
        <dt class="text-base-content/50">Theme API</dt>
        <dd data-testid="theme-detail-api">{viewModel.detail.themeApiRange}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-base-content/50">Package</dt>
        <dd>{viewModel.detail.packageBytes} bytes</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-base-content/50">Assets</dt>
        <dd data-testid="theme-detail-asset-count">{viewModel.assetRows.length}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-base-content/50">HUD preset</dt>
        <dd>
          {viewModel.detail.hasHudPreset
            ? 'ships an optional HUD preset (separate opt-in)'
            : 'none'}
        </dd>
      </div>
    </dl>

    <ul class="flex flex-col gap-1 text-xs text-base-content/70" data-testid="theme-detail-variants">
      {#each viewModel.variantRows as row (row.variant)}
        <li data-testid="theme-detail-variant-fact">
          <span class="font-medium text-base-content">{row.variant}</span>
          · fonts {row.fontFamilyLabel} · weights {row.fontWeightLabel} · {row.tokenLabel}
        </li>
      {/each}
    </ul>

    {#if viewModel.assetRows.length > 0}
      <ul class="flex flex-col gap-1 font-mono text-[11px] text-base-content/60">
        {#each viewModel.assetRows as asset (asset.path)}
          <li data-testid="theme-detail-asset">
            {asset.path} · {asset.mediaType} · {asset.sizeLabel}{asset.isPreview
              ? ' · preview'
              : ''}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex flex-col gap-2" aria-labelledby="theme-install-heading">
    <h2 id="theme-install-heading" class="font-display text-xl text-base-content">
      Install in the game
    </h2>
    <p class="text-sm text-base-content/70">
      The client downloads this exact version from the Hub it is already configured to trust, checks
      the package again on your device, and shows you a Preview. Nothing changes until you choose
      Apply, and your own accessibility and HUD choices are kept.
    </p>
    <p class="flex flex-wrap items-center gap-3">
      <a
        class="rounded-md border border-base-300 px-4 py-2 text-sm font-medium text-base-content transition-colors hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        href={viewModel.installHref}
        data-testid="theme-detail-download"
      >
        Download {viewModel.installLabel}
      </a>
      <span class="font-mono text-[11px] text-base-content/50">
        {viewModel.detail.sha256.slice(0, 16)}…
      </span>
    </p>
    <p class="text-[11px] text-base-content/50">
      Already have it? Open Settings → Interface → Appearance → Import theme package and pick the
      file. Offline installs keep working without a Hub connection.
    </p>
  </section>

  {#if viewModel.isOwner}
    <p
      class="rounded-md border border-base-300 bg-base-200 p-3 text-xs text-base-content/70"
      data-testid="theme-detail-owner-note"
    >
      You published this version. Pending versions are visible only to you until a moderator
      approves them.
    </p>
  {/if}
</BaseViewModelContainer>
