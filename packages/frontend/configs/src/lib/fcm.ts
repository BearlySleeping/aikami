// packages/frontend/configs/src/lib/fcm.ts
import { getMessaging, type Messaging } from 'firebase/messaging';
import app from './app.ts';

export { deleteToken, getToken, onMessage } from 'firebase/messaging';

const initializeMessagingInstance = (): Messaging => {
  return getMessaging(app);
};

export const messaging = initializeMessagingInstance();
