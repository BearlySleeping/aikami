<script lang="ts">
  // packages/frontend/components/src/lib/modal/modal.svelte

  /** Width constraint for the modal dialog box. */
  type ModalSize = 'sm' | 'md' | 'lg' | 'max';

  type Props = {
    /**
     * Controls the display state of the modal dialog.
     * Supports Svelte 5 two-way binding so the parent can read back the closed state.
     */
    open: boolean;
    /**
     * Optional snippet for the modal header section.
     * Render any content — icon, heading, or custom structure.
     */
    title?: import('svelte').Snippet;
    /** Required snippet for the modal body content. */
    children: import('svelte').Snippet;
    /** Optional snippet for action buttons at the bottom of the modal. */
    actions?: import('svelte').Snippet;
    /**
     * Controls the max-width of the modal box via Tailwind utilities.
     * @default 'md'
     */
    size?: ModalSize;
    /**
     * Whether clicking the modal backdrop dismisses the dialog.
     * When false, only programmatic close or Escape will dismiss.
     * @default true
     */
    closeOnBackdropClick?: boolean;
    /** Callback fired exactly once when the modal closes by any means. */
    onclose?: () => void;
  };

  let {
    open = $bindable(),
    title,
    children,
    actions,
    size = 'md',
    closeOnBackdropClick = true,
    onclose,
  }: Props = $props();

  let dialogRef: HTMLDialogElement | undefined;

  const _sizeClass: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    max: 'max-w-5xl',
  };

  /**
   * Prevents the onclose callback from firing twice when dialog.close() is
   * invoked from the $effect synchronizing external open → false changes.
   */
  let _closingFromEffect = false;

  $effect(() => {
    const dialog = dialogRef;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      _closingFromEffect = true;
      dialog.close();
    }
  });

  const _handleNativeClose = (): void => {
    if (_closingFromEffect) {
      _closingFromEffect = false;
      return;
    }
    open = false;
    if (onclose) {
      onclose();
    }
  };
</script>

<dialog bind:this={dialogRef} class="modal" onclose={_handleNativeClose}>
  <div class="modal-box {_sizeClass[size]}">
    {#if title}
      <div class="modal-header mb-4">
        {@render title()}
      </div>
    {/if}

    {@render children()}

    {#if actions}
      <div class="modal-action">
        {@render actions()}
      </div>
    {/if}
  </div>

  {#if closeOnBackdropClick}
    <form method="dialog" class="modal-backdrop">
      <button type="submit" class="sr-only">close</button>
    </form>
  {/if}
</dialog>
