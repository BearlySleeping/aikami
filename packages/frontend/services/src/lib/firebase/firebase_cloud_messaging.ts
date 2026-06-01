import { publicEnv } from '@aikami/frontend/configs/environment';
import { BaseClass, type BaseClassInterface } from '@aikami/utils';
import type { MessagePayload, NextFn, Observer, Unsubscribe } from 'firebase/messaging';

type Fcm = typeof import('@aikami/frontend/configs/fcm.ts');

export type FirebaseCloudMessagingServiceInterface = {
  registerFCM(): Promise<string>;
  onMessage(
    nextOrObserver: NextFn<MessagePayload> | Observer<MessagePayload>,
  ): Promise<Unsubscribe>;
  deleteToken(): Promise<void>;
} & BaseClassInterface;

class FirebaseCloudMessagingService
  extends BaseClass
  implements FirebaseCloudMessagingServiceInterface
{
  private static _fcm?: Fcm;

  async onMessage(
    nextOrObserver: NextFn<MessagePayload> | Observer<MessagePayload>,
  ): Promise<Unsubscribe> {
    const { messaging, onMessage } = await this._getFCM();
    return onMessage(messaging, nextOrObserver);
  }

  async deleteToken(): Promise<void> {
    const { deleteToken, messaging } = await this._getFCM();
    const token = await deleteToken(messaging);
    this.log('deleteToken', token);
  }

  async registerFCM(): Promise<string> {
    this.log('registerFCM');
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers are not supported by this browser');
    }

    const [registration, { getToken, messaging }] = await Promise.all([
      navigator.serviceWorker.register(
        import.meta.env.MODE === 'production' ? '/sw.js' : '/dev-sw.js?dev-sw',
        {
          type: import.meta.env.MODE === 'production' ? 'classic' : 'module',
        },
      ),
      this._getFCM(),
    ]);

    const token = await getToken(messaging, {
      serviceWorkerRegistration: registration,
      vapidKey: publicEnv.PUBLIC_VAPID_KEY ?? '',
    });
    return token;
  }

  private async _getFCM(): Promise<Fcm> {
    if (FirebaseCloudMessagingService._fcm) {
      return FirebaseCloudMessagingService._fcm;
    }

    if (import.meta.env.SSR || typeof window === 'undefined' || import.meta.env.STORYBOOK) {
      throw new Error(`${this._className} is not available on SSR`);
    }

    FirebaseCloudMessagingService._fcm = await import('@aikami/frontend/configs/fcm.ts');
    return FirebaseCloudMessagingService._fcm;
  }
}

export const firebaseCloudMessagingService: FirebaseCloudMessagingServiceInterface =
  new FirebaseCloudMessagingService({
    className: 'FirebaseCloudMessagingService',
  });
