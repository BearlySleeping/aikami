<script lang="ts">
  // apps/frontend/client/src/lib/views/app/drawer/notification/NotificationDrawer.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import { getNotificationDrawerViewModel } from './notification_drawer_view_model.svelte.ts';

  const viewModel = getNotificationDrawerViewModel({
    className: 'NotificationDrawer',
  });
</script>

<BaseViewModelContainer {viewModel} class="drawer drawer-end">
  <input
    id="notification-drawer"
    type="checkbox"
    class="drawer-toggle"
    checked={viewModel.showNotificationDrawer}
    onchange={(e) =>
            viewModel.toggleNotificationDrawer(e.currentTarget.checked)}
  >
  <div class="drawer-side z-50">
    <label for="notification-drawer" class="drawer-overlay"></label>
    <div class="menu p-4 w-80 min-h-full bg-base-200 text-base-content">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">{t.notifications()}</h2>
        <button
          class="btn btn-ghost btn-sm"
          onclick={() => viewModel.toggleNotificationDrawer(false)}
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {#if viewModel.notificationCount > 0}
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm opacity-70"
            >{viewModel.notificationCount}
            notification{viewModel.notificationCount ===
                        1
                            ? ""
                            : "s"}</span
          >
          <button class="btn btn-ghost btn-xs" onclick={() => viewModel.clearNotifications()}>
            {t.mark_all_as_read()}
          </button>
        </div>

        <div class="divider my-2"></div>

        <ul class="space-y-2">
          {#each viewModel.notificationDrawerItems as notification (notification.id)}
            <li>
              <button
                class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow w-full text-left p-3"
                onclick={() =>
                                    viewModel.handleNotificationClick(
                                        notification,
                                    )}
              >
                <div class="flex gap-3">
                  {#if notification.imageURL}
                    <div class="avatar">
                      <div class="w-12 h-12 rounded-full">
                        <img src={notification.imageURL} alt="">
                      </div>
                    </div>
                  {/if}
                  <div class="flex-1">
                    <p class="font-medium text-sm">{notification.notificationType}</p>
                    <p class="text-xs opacity-70 mt-1">
                      {notification.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="flex flex-col items-center justify-center h-full py-12">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-16 w-16 opacity-30 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          <h3 class="text-lg font-semibold mb-2">{t.no_notifications_title()}</h3>
          <p class="text-sm opacity-70 text-center">{t.no_notifications_subtitle()}</p>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
