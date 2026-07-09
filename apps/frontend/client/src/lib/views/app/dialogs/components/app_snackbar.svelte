<script lang="ts">
  // apps/frontend/client/src/lib/views/app/dialogs/components/app_snackbar.svelte
  //
  // Toast stack using DaisyUI toast + alert. Toasts auto-dismiss
  // after 5s. Multiple toasts stack vertically. Click to dismiss.

  import type { AppDialogsViewModelInterface } from '../app_dialogs_view_model.svelte';

  type Props = {
    viewModel: AppDialogsViewModelInterface;
  };

  const { viewModel }: Props = $props();

  const alertClass = (type: string) => {
    switch (type) {
      case 'success':
        return 'alert-success';
      case 'error':
        return 'alert-error';
      case 'warning':
        return 'alert-warning';
      default:
        return 'alert-info';
    }
  };

  const alertIcon = (type: string) => {
    switch (type) {
      case 'success':
        return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'error':
        return 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'warning':
        return 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z';
      default:
        return 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
    }
  };
</script>

{#if viewModel.toasts.length > 0}
  <div class="toast toast-end z-50">
    {#each viewModel.toasts as toast (toast.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        role="alert"
        class="alert {alertClass(toast.type)} cursor-pointer shadow-lg"
        onclick={() => viewModel.dismissToast(toast.id)}
        onkeydown={(e) => e.key === 'Enter' && viewModel.dismissToast(toast.id)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <title>icon</title>
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d={alertIcon(toast.type)}
          />
        </svg>
        <span>{toast.text}</span>
      </div>
    {/each}
  </div>
{/if}
