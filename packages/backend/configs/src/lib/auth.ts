import { type Auth, getAuth as fbGetAuth } from 'firebase-admin/auth';

import { getApp } from './app.ts';

let _auth: Auth | undefined;

export const getAuth = () => {
  if (!_auth) {
    _auth = fbGetAuth(getApp());
  }
  return _auth;
};
