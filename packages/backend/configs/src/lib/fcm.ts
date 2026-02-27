import { getMessaging as fbGetMessaging } from 'firebase-admin/messaging';
import { getApp } from './app.ts';

let _messaging: ReturnType<typeof fbGetMessaging> | undefined;

export const getMessaging = () => {
  if (!_messaging) {
    _messaging = fbGetMessaging(getApp());
  }
  return _messaging;
};
