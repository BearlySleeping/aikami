import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/index.ts';
import type { NotificationData } from '@aikami/types/index.ts';
import { getDate } from '@aikami/utils/index.ts';
import { appService, authService, notificationService } from '$services/index.ts';

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
  readonly showNotificationDrawer = $derived(appService.showNotificationDrawer);

  readonly notificationDrawerItems = $derived.by(() => {
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
  });

  readonly notificationCount = $derived(notificationService.notificationsAmount);

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
    this.debug('Notification drawer toggled', { isOpen });
    appService.toggleNotificationDrawer(isOpen);
  }

  handleNotificationClick(notification: NotificationDrawerItem): void {
    this.debug('Notification clicked', notification);
    // Add any additional click handling logic here
    // For example: navigate to specific route based on notification type
  }
}

export const getNotificationDrawerViewModel = (
  options: NotificationDrawerViewModelOptions,
): NotificationDrawerViewModelInterface => new NotificationDrawerViewModel(options);
