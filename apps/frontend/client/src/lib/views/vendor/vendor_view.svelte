<script lang="ts">
// apps/frontend/client/src/lib/views/vendor/vendor_view.svelte
import { logger } from '$logger';
import { gameModeService } from '$services';
import type { VendorViewModelInterface } from './vendor_view_model.svelte';

type Props = {
  viewModel: VendorViewModelInterface;
};

const { viewModel }: Props = $props();

/** Reference to the scrollable message container for auto-scroll. */
let messageContainer = $state<HTMLDivElement>();

/** Reference to the textarea for mode-aware autofocus. */
let inputElement = $state<HTMLTextAreaElement>();

/** Player's current haggling text. */
let haggleInput = $state('');

// ── Toast system for purchase notifications ──────────────────────────

/** Toast entries shown after purchases. Each auto-dismisses after 2.5s. */
const toasts = $state<
  Array<{ id: string; message: string; itemId: string; type: 'success' | 'error' }>
>([]);

/** Adds a toast notification and removes it after 2.5 seconds. */
const _showToast = (message: string, itemId: string, type: 'success' | 'error') => {
  const id = crypto.randomUUID();
  toasts.push({ id, message, itemId, type });
  setTimeout(() => {
    const idx = toasts.findIndex((t) => t.id === id);
    if (idx >= 0) {
      toasts.splice(idx, 1);
    }
  }, 2500);
};

// ── Purchase wrapper with toast ──────────────────────────────────────

/**
 * Wraps the ViewModel's buyItem with a toast notification.
 * The ViewModel handles transaction messages internally via the
 * inline bar — this adds a floating toast for extra visibility.
 */
const buyItemWithToast = async (itemId: string, label: string) => {
  logger.debug('[vendor_view] buyItemWithToast:click', {
    itemId,
    label,
    playerGold: viewModel.playerGold,
    isBuying: viewModel.isBuying,
    refusesToSell: viewModel.refusesToSell,
    isHaggling: viewModel.isHaggling,
  });
  const goldBefore = viewModel.playerGold;
  await viewModel.buyItem(itemId);
  logger.debug('[vendor_view] buyItemWithToast:after-buyItem', {
    itemId,
    goldBefore,
    goldAfter: viewModel.playerGold,
    delta: viewModel.playerGold - goldBefore,
    isBuying: viewModel.isBuying,
  });
  // If gold decreased, the purchase likely succeeded (or at least was attempted)
  if (viewModel.playerGold < goldBefore) {
    _showToast(`Purchased ${label}!`, itemId, 'success');
  } else if (viewModel.playerGold === goldBefore && !viewModel.refusesToSell) {
    _showToast(`Cannot afford ${label}`, itemId, 'error');
  }
};

/** Submit the haggling message and clear the input. */
const submitHaggle = async () => {
  const text = haggleInput.trim();
  if (!text || viewModel.isHaggling || viewModel.refusesToSell) {
    logger.debug('[vendor_view] submitHaggle:blocked', {
      text: !!text,
      isHaggling: viewModel.isHaggling,
      refusesToSell: viewModel.refusesToSell,
    });
    return;
  }
  logger.debug('[vendor_view] submitHaggle:sending', { text: text.slice(0, 50) });
  haggleInput = '';
  await viewModel.haggle(text);
};

/** Handle Enter key for submit (Shift+Enter for newline). */
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void submitHaggle();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    viewModel.closeVendor();
  }
};

/** Mode-aware autofocus: focus the textarea when MENU/game mode is active. */
$effect(() => {
  if (gameModeService.currentMode === 'MENU' && inputElement) {
    inputElement.focus();
  }
});

/** Auto-scroll to the bottom when new messages arrive or AI is streaming. */
$effect(() => {
  const count = viewModel.messages.length;
  const haggling = viewModel.isHaggling;
  void count;
  void haggling;
  if (messageContainer) {
    messageContainer.scrollTop = messageContainer.scrollHeight;
  }
});

// ── Item icon mapping ────────────────────────────────────────────────

/** Returns a representative emoji icon for a given item ID. */
const _itemIcon = (itemId: string): string => {
  if (itemId.includes('sword') || itemId.includes('blade')) {
    return '⚔️';
  }
  if (itemId.includes('shield')) {
    return '🛡️';
  }
  if (itemId.includes('armor') || itemId.includes('plate') || itemId.includes('mail')) {
    return '🛡️';
  }
  if (itemId.includes('potion') || itemId.includes('elixir')) {
    return '🧪';
  }
  if (itemId.includes('coin') || itemId.includes('gold')) {
    return '🪙';
  }
  if (itemId.includes('ring') || itemId.includes('amulet')) {
    return '💍';
  }
  if (itemId.includes('scroll') || itemId.includes('book')) {
    return '📜';
  }
  if (itemId.includes('bow') || itemId.includes('arrow')) {
    return '🏹';
  }
  return '📦';
};
</script>

<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm"
  onclick={() => viewModel.closeVendor()}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  aria-label="Trading with {viewModel.vendorName}"
  onkeydown={handleKeyDown}
>
  <div
    class="flex w-full max-w-5xl h-[80vh] rounded-xl border border-base-300 bg-base-200 shadow-2xl overflow-hidden"
    onclick={(e: MouseEvent) => e.stopPropagation()}
    role="none"
  >
    <!-- ── Left pane: AI Chat ── -->
    <div class="flex flex-col w-3/5 border-r border-base-300">
      <!-- Header -->
      <div
        class="flex items-center justify-between border-b border-base-300 px-4 py-3 bg-base-100/50"
      >
        <div class="flex items-center gap-2">
          <span class="text-lg">🏪</span>
          <h3 class="text-sm font-bold text-primary">{viewModel.vendorName}</h3>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-error"
          onclick={() => viewModel.closeVendor()}
          aria-label="Close vendor"
        >
          ✕ Leave
        </button>
      </div>

      <!-- Messages -->
      <div bind:this={messageContainer} class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {#if viewModel.messages.length === 0}
          <div class="flex flex-col items-center justify-center h-full text-base-content/30 gap-2">
            <span class="text-4xl">💬</span>
            <p class="text-sm">Start a conversation to haggle with the vendor</p>
          </div>
        {:else}
          {#each viewModel.messages as message (message.id)}
            <div class="chat {message.role === 'player' ? 'chat-end' : 'chat-start'}">
              <div class="chat-header mb-0.5 text-xs text-base-content/50">
                {message.role === 'player' ? 'You' : viewModel.vendorName}
              </div>
              <div
                class="chat-bubble text-sm {message.role === 'player'
                  ? 'chat-bubble-primary'
                  : 'chat-bubble-secondary'}"
              >
                {message.content || '...'}
              </div>
            </div>
          {/each}
        {/if}

        <!-- Loading spinner -->
        {#if viewModel.isHaggling}
          <div class="chat chat-start">
            <div class="chat-bubble chat-bubble-secondary text-sm">
              <span class="loading loading-dots loading-xs"></span>
            </div>
          </div>
        {/if}

        <!-- Refuses to sell banner -->
        {#if viewModel.refusesToSell}
          <div class="alert alert-error mt-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <title>icon</title>
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <span class="text-sm font-semibold">The vendor refuses to do business with you.</span>
          </div>
        {/if}
      </div>

      <!-- Input area -->
      <div class="border-t border-base-300 p-3 bg-base-100/50">
        <div class="flex gap-2">
          <textarea
            bind:this={inputElement}
            bind:value={haggleInput}
            class="textarea textarea-bordered flex-1 text-sm resize-none"
            rows="2"
            placeholder="{viewModel.refusesToSell ? 'The vendor won\'t talk to you...' : 'Type to haggle, chat, or browse...'}"
            disabled={viewModel.isHaggling || viewModel.refusesToSell}
          ></textarea>
          <button
            type="button"
            class="btn btn-primary btn-sm self-end"
            onclick={() => submitHaggle()}
            disabled={viewModel.isHaggling || viewModel.refusesToSell || !haggleInput.trim()}
          >
            {#if viewModel.isHaggling}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              Send
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-2 mt-1.5 text-xs text-base-content/30">
          <kbd class="kbd kbd-xs">Enter</kbd>
          send
          <span>·</span>
          <kbd class="kbd kbd-xs">Shift+Enter</kbd>
          newline
        </div>
      </div>
    </div>

    <!-- ── Right pane: Items + Gold ── -->
    <div class="flex flex-col w-2/5 bg-base-100">
      <!-- Gold display -->
      <div
        class="flex items-center justify-between border-b border-base-300 px-4 py-3 bg-gradient-to-r from-amber-900/20 to-amber-700/10"
      >
        <span class="text-sm font-semibold text-base-content">Your Gold</span>
        <span class="badge badge-lg badge-warning text-sm font-bold gap-1">
          🪙 {viewModel.playerGold}
        </span>
      </div>

      <!-- Price multiplier indicator -->
      {#if viewModel.priceMultiplier !== 1.0}
        <div class="px-4 py-2 border-b border-base-300 bg-base-200/30">
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-base-content/60">Price Modifier:</span>
            <span
              class="badge badge-sm gap-0.5 {viewModel.priceMultiplier < 1.0
                ? 'badge-success'
                : 'badge-error'}"
            >
              {viewModel.priceMultiplier < 1.0 ? '▼' : '▲'}
              {Math.abs((viewModel.priceMultiplier - 1) * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      {/if}

      <!-- Transaction message bar -->
      {#if viewModel.transactionMessage}
        <div
          class="px-4 py-2 border-b border-base-300 {viewModel.transactionSuccess
            ? 'bg-success/10 text-success'
            : 'bg-error/10 text-error'}"
        >
          <p class="text-xs font-medium">{viewModel.transactionMessage}</p>
        </div>
      {/if}

      <!-- Vendor inventory header -->
      <div class="px-4 pt-3 pb-1 flex items-center gap-2">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >For Sale</span
        >
        <div class="flex-1 border-t border-base-300"></div>
        <span class="text-xs text-base-content/30">{viewModel.items.length} items</span>
      </div>

      <!-- Items grid -->
      <div class="flex-1 overflow-y-auto px-3 pb-3">
        {#if viewModel.items.length === 0}
          <div class="flex flex-col items-center justify-center h-full text-base-content/40 gap-2">
            <span class="text-3xl">📦</span>
            <p class="text-sm">This vendor has nothing for sale.</p>
          </div>
        {:else}
          <div class="grid grid-cols-2 gap-2">
            {#each viewModel.items as item (item.itemId)}
              {@const finalPrice = viewModel.getFinalPrice(item.basePrice)}
              {@const canAfford = viewModel.playerGold >= finalPrice}
              {@const isDiscounted = finalPrice < item.basePrice}
              {@const isPenalized = finalPrice > item.basePrice}
              {@const icon = _itemIcon(item.itemId)}
              {@const definition = viewModel.getItemDef(item.itemId)}
              <div
                class="flex flex-col gap-2 rounded-xl border-2 {canAfford && !viewModel.refusesToSell
                  ? 'border-base-300 hover:border-primary/50 hover:shadow-md'
                  : 'border-base-300 opacity-40'} bg-base-200 p-3 transition-all duration-200"
              >
                <!-- Item icon + name -->
                <div class="flex items-center gap-2">
                  <div
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {canAfford
                      ? 'bg-primary/10'
                      : 'bg-base-300'}"
                  >
                    <span class="text-lg">{icon}</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <h4 class="text-sm font-semibold text-base-content truncate">{item.label}</h4>
                    <div class="flex items-center gap-1 mt-0.5">
                      <span
                        class="text-xs font-bold {isDiscounted
                          ? 'text-success'
                          : isPenalized
                            ? 'text-error'
                            : 'text-warning'}"
                      >
                        🪙 {finalPrice}
                      </span>
                      {#if isDiscounted}
                        <span class="text-xs text-base-content/30 line-through"
                          >{item.basePrice}</span
                        >
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- Stats (if equippable) -->
                <!-- Stats (if equippable) -->
                <!-- Stats (if equippable) -->
                <!-- Stats (if equippable) -->
                {#if definition && (definition.attackBonus > 0 || definition.defenseBonus > 0)}
                  <div class="flex items-center gap-1.5 text-xs text-base-content/50">
                    {#if definition.attackBonus > 0}
                      <span class="text-warning">⚔️ +{definition.attackBonus}</span>
                    {/if}
                    {#if definition.defenseBonus > 0}
                      <span class="text-info">🛡️ +{definition.defenseBonus}</span>
                    {/if}
                  </div>
                {/if}

                <!-- Buy button -->
                <button
                  type="button"
                  class="btn btn-xs w-full gap-1 {canAfford
                    ? 'btn-primary'
                    : 'btn-ghost'} {viewModel.refusesToSell ? 'btn-disabled' : ''}"
                  onclick={() => buyItemWithToast(item.itemId, item.label)}
                  disabled={!canAfford || viewModel.isBuying || viewModel.refusesToSell}
                >
                  {#if viewModel.isBuying}
                    <span class="loading loading-spinner loading-xs"></span>
                    Buying...
                  {:else if viewModel.refusesToSell}
                    🚫 Refused
                  {:else if !canAfford}
                    💰 Need {finalPrice - viewModel.playerGold} more
                  {:else}
                    🛒 Buy for {finalPrice}g
                  {/if}
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- ── Sell section (C-331 AC-3) ── -->
        <div class="pt-3 pb-1 flex items-center gap-2">
          <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
            >Sell Your Items</span
          >
          <div class="flex-1 border-t border-base-300"></div>
          <span class="text-xs text-base-content/30">{viewModel.sellableItems.length} items</span>
        </div>

        {#if viewModel.sellableItems.length === 0}
          <p class="text-xs text-base-content/40 text-center py-2">Nothing the vendor will buy.</p>
        {:else}
          <div class="flex flex-col gap-1.5">
            {#each viewModel.sellableItems as sellable (sellable.itemId)}
              <div
                class="flex items-center gap-2 rounded-lg border border-base-300 bg-base-200 px-3 py-2"
              >
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-medium text-base-content truncate">
                    {sellable.label}
                  </span>
                  {#if sellable.quantity > 1}
                    <span class="badge badge-xs badge-ghost ml-1">x{sellable.quantity}</span>
                  {/if}
                </div>
                <span class="text-xs font-bold text-warning">🪙 {sellable.sellPrice}</span>
                <button
                  type="button"
                  class="btn btn-xs btn-outline btn-warning"
                  onclick={() => viewModel.requestSell(sellable.itemId)}
                  aria-label="Sell {sellable.label} for {sellable.sellPrice} gold"
                >
                  Sell
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Sell confirmation -->
        {#if viewModel.pendingSellItemId}
          <div
            class="mt-2 rounded-lg border border-warning/50 bg-warning/10 p-3"
            role="alertdialog"
            aria-label="Confirm sale"
          >
            <p class="text-sm text-base-content mb-2">
              Sell <span class="font-bold">{viewModel.pendingSellLabel}</span> for
              <span class="font-bold text-warning">{viewModel.pendingSellPrice} gold</span>?
            </p>
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                onclick={() => viewModel.cancelSell()}
                aria-label="Cancel sale"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-xs btn-warning"
                onclick={() => viewModel.confirmSell()}
                aria-label="Confirm sale of {viewModel.pendingSellLabel}"
              >
                Confirm Sale
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Footer hint -->
      <div class="border-t border-base-300 px-4 py-2.5 bg-base-200/50">
        <div class="flex items-center justify-center gap-3">
          <div class="flex items-center gap-1.5">
            <kbd class="kbd kbd-xs text-xs">Esc</kbd>
            <span class="text-xs text-base-content/40">close</span>
          </div>
          <span class="text-base-content/15">|</span>
          <div class="flex items-center gap-1.5">
            <kbd class="kbd kbd-xs text-xs">Enter</kbd>
            <span class="text-xs text-base-content/40">send</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Toast notifications (absolute positioned, top-right) ── -->
  <div class="absolute top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
    {#each toasts as toast (toast.id)}
      <div
        class="pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2.5 shadow-lg animate-in slide-in-from-right {toast.type === 'success' ? 'bg-success text-success-content' : 'bg-error text-error-content'}"
      >
        <span>{toast.type === 'success' ? '✅' : '❌'}</span>
        <span class="text-sm font-semibold">{toast.message}</span>
      </div>
    {/each}
  </div>
</div>
