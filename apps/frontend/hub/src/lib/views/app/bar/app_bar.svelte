<script lang="ts">
import { BaseViewModelContainer, Image } from '$components';
import { getAppBarViewModel } from './app_bar_view_model.svelte.ts';

const viewModel = getAppBarViewModel({ className: 'AppBarViewModel' });

// Close the profile menu with Escape while it is open (window-level, since
// the backdrop is not focusable).
$effect(() => {
  if (!viewModel.menuOpen) {
    return;
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      viewModel.closeMenu();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
});
</script>

<BaseViewModelContainer
  {viewModel}
  class="flex items-center justify-between border-b border-border bg-background/40 px-4 py-3"
>
  <!-- Left -->
  <div class="flex items-center gap-3">
    {#if viewModel.showDrawerButton && viewModel.isLoggedIn}
      <label
        for="left-drawer"
        class="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
      >
        <svg
          role="img"
          aria-label="Toggle navigation drawer"
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </label>
    {/if}

    <button
      type="button"
      class="font-display text-lg text-foreground transition-colors hover:text-primary"
      onclick={() => viewModel.goToHome()}
    >
      Aikami Hub
    </button>
  </div>

  <!-- Center -->
  <div class="flex items-center">
    {#if viewModel.appBarTitle}
      <h1 class="font-display text-base text-foreground">{viewModel.appBarTitle}</h1>
    {/if}
  </div>

  <!-- Right -->
  <div class="flex items-center gap-2">
    {#if viewModel.isLoggedIn}
      <div class="relative">
        <button
          type="button"
          onclick={() => { viewModel.toggleMenu(); }}
          class="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {#if viewModel.currentUser?.photoURL}
            <Image
              src={viewModel.currentUser.photoURL}
              alt="Profile"
              class="h-full w-full rounded-full object-cover"
            />
          {:else}
            <svg
              role="img"
              aria-label="Profile menu"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          {/if}
        </button>

        {#if viewModel.menuOpen}
          <!-- biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay for closing profile menu -->
          <div
            class="fixed inset-0 z-40"
            onclick={() => { viewModel.closeMenu(); }}
            role="presentation"
          ></div>
          <div
            class="absolute right-0 top-full mt-2 z-50 w-48 rounded-lg border border-border bg-card py-1 shadow-elevated"
          >
            {#each viewModel.profileMenuOptions as option (option.text)}
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                onclick={() => { option.click(); viewModel.closeMenu(); }}
              >
                <svg
                  role="img"
                  aria-label={option.text}
                  class="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d={option.icon} />
                </svg>
                {option.text}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        class="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onclick={() => viewModel.goToLogin()}
      >
        Login
      </button>
    {/if}
  </div>
</BaseViewModelContainer>
