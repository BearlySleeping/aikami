// apps/frontend/hub/src/lib/views/app/drawer/notification/notification_drawer_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { appService } from '$services';

export type NotificationDrawerItem = {
  id: string;
  notificationType: string;
  createdAt: Date;
  click: () => void;
  imageURL?: string;
};

export type NotificationDrawerViewModelOptions = BaseViewModelOptions;

export type NotificationDrawerViewModelInterface = BaseViewModelInterface & {
  readonly showNotificationDrawer: boolean;
  readonly notificationDrawerItems: NotificationDrawerItem[];
  readonly notificationCount: number;

  clearNotifications(): Promise<void>;
  toggleNotificationDrawer(isOpen: boolean): void;
  handleNotificationClick(notification: NotificationDrawerItem): void;
};

class NotificationDrawerViewModel
  extends BaseViewModel<NotificationDrawerViewModelOptions>
  implements NotificationDrawerViewModelInterface
{
  get showNotificationDrawer(): boolean {
    return appService.showNotificationDrawer;
  }

  get notificationDrawerItems(): NotificationDrawerItem[] {
    // Stub — admin currently has no notification backend
    return [];
  }

  get notificationCount(): number {
    return this.notificationDrawerItems.length;
  }

  async clearNotifications(): Promise<void> {
    this.debug('Notifications cleared');
  }

  toggleNotificationDrawer(isOpen: boolean): void {
    appService.toggleNotificationDrawer(isOpen);
  }

  handleNotificationClick(notification: NotificationDrawerItem): void {
    this.debug('Notification clicked', notification);
  }
}

export const getNotificationDrawerViewModel = (
  options: NotificationDrawerViewModelOptions,
): NotificationDrawerViewModelInterface => NotificationDrawerViewModel.create(options);
