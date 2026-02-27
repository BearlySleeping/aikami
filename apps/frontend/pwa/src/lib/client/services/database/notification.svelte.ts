import {
  type NotificationRepositoryInterface,
  notificationRepository,
} from '@aikami/frontend/repositories/notification';

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { NotificationData, Subscription } from '@aikami/types';

export type NotificationServiceOptions = BaseFrontendClassOptions & {
  database: NotificationRepositoryInterface;
};

export type NotificationServiceInterface = BaseFrontendClassInterface & {
  /**
   * An array of notifications.
   */
  readonly notifications: NotificationData[];

  /**
   * The number of notifications.
   */
  readonly notificationsAmount: number;

  /**
   * Clears all notifications for a user.
   * @param options The options.
   * @returns A promise that resolves with true if the notifications were cleared successfully, false otherwise.
   */
  clearNotifications(options: { uid: string }): Promise<boolean>;

  /**
   * Listens for notifications for a user.
   * @param uid The user ID.
   */
  listenForNotifications(uid?: string): Promise<void>;
};

export class NotificationService
  extends BaseFrontendClass<NotificationServiceOptions>
  implements NotificationServiceInterface
{
  notifications = $state<NotificationData[]>([]);

  get notificationsAmount(): number {
    return this.notifications.length;
  }
  /**
   * The UID of the user that is currently being listened to.
   */
  private currentUID: string | undefined;

  /**
   * The subscription to the notifications stream.
   */
  private notificationsSubscription?: Subscription;

  private get _database(): NotificationRepositoryInterface {
    return this._options.database;
  }

  async clearNotifications(options: { uid: string }): Promise<boolean> {
    this.log('clearNotifications', options);
    const { uid } = options;
    try {
      const notifications = this.notifications;
      if (!uid || !notifications.length) {
        return true;
      }

      await this._database.deleteDocuments(
        notifications.map((notification) => ({
          notificationId: notification.id,
          uid,
        })),
      );

      return true;
    } catch (error) {
      this.error('clearNotifications', error);
      return false;
    }
  }

  override async dispose(): Promise<void> {
    this.notificationsSubscription?.unsubscribe();
    await super.dispose();
  }

  async listenForNotifications(uid?: string): Promise<void> {
    if (this.currentUID === uid) {
      return;
    }
    this.currentUID = uid;
    this.notificationsSubscription?.unsubscribe();
    this.notifications = [];

    if (!this.currentUID) {
      return;
    }

    const observable = await this._database.getDocumentsStreamByQuery({
      getCollectionPathArgument: {
        uid: this.currentUID,
      },
    });
    this.notificationsSubscription = observable((notifications?: NotificationData[]) => {
      this.notifications = notifications ?? [];
    });
  }
}

export const notificationService: NotificationServiceInterface = new NotificationService({
  database: notificationRepository,
  className: 'NotificationService',
});
