// apps/frontend/client/src/lib/views/app/drawer/notification/notification-drawer-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { NotificationData } from '@aikami/types';
import { getDate } from '@aikami/utils';
import { appService, authService, notificationService } from '$services';

export type NotificationDrawerItem = {
  createdAt: Date;
  click: () => void;
  imageURL?: string;
} & Omit<NotificationData, 'createdAt'>;

export type NotificationDrawerViewModelOptions = BaseViewModelOptions;

export type NotificationDrawerViewModelInterface = BaseViewModelInterface & {
  /**
   * Whether to show the notification drawer.
   */
  readonly showNotificationDrawer: boolean;

  /**
   * The items to display in the notification drawer.
   */
  readonly notificationDrawerItems: NotificationDrawerItem[];

  /**
   * The number of notifications.
   */
  readonly notificationCount: number;

  /**
   * Clears all notifications.
   */
  clearNotifications(): Promise<void>;

  /**
   * Toggles the notification drawer.
   * @param isOpen Whether the drawer should be open.
   */
  toggleNotificationDrawer(isOpen: boolean): void;

  /**
   * Handles a click on a notification.
   * @param notification The notification that was clicked.
   */
  handleNotificationClick(notification: NotificationDrawerItem): void;
};

class NotificationDrawerViewModel
  extends BaseViewModel<NotificationDrawerViewModelOptions>
  implements NotificationDrawerViewModelInterface
{
  get showNotificationDrawer() {
    return appService.showNotificationDrawer;
  }

  get notificationDrawerItems() {
    const notifications = notificationService.notifications;

    return notifications.map((notification) => ({
      ...notification,
      click: () =>
        this.handleNotificationClick({
          ...notification,
          createdAt: getDate(notification.createdAt),
          imageURL: '',
          click: () => {},
        }),
      createdAt: getDate(notification.createdAt),
      imageURL: '',
    }));
  }

  get notificationCount() {
    return notificationService.notificationsAmount;
  }

  async clearNotifications(): Promise<void> {
    const uid = authService.uid;
    if (!uid) {
      this.warn('Cannot clear notifications: user not authenticated');
      return;
    }

    try {
      await notificationService.clearNotifications({ uid });
      this.debug('Notifications cleared successfully');
    } catch (err) {
      this.error('Failed to clear notifications', err);
    }
  }

  toggleNotificationDrawer(isOpen: boolean): void {
    appService.toggleNotificationDrawer(isOpen);
  }

  handleNotificationClick(_notification: NotificationDrawerItem): void {
    // Add any additional click handling logic here
    // For example: navigate to specific route based on notification type
  }
}

export const getNotificationDrawerViewModel = (
  options: NotificationDrawerViewModelOptions,
): NotificationDrawerViewModelInterface => new NotificationDrawerViewModel(options);
