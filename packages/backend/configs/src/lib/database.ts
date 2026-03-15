import {
  type Firestore,
  initializeFirestore as fbInitializeFirestore,
} from 'firebase-admin/firestore';
import { getApp } from './app.ts';

let _database: Firestore | undefined;

export const getFirestore = (): Firestore => {
  if (_database) {
    return _database;
  }
  const app = getApp();
  const preferRest = true;
  _database = fbInitializeFirestore(app, { preferRest });

  return _database;
};
