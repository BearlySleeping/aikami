// packages/backend/configs/src/lib/firestore.ts
import {
  FieldPath,
  FieldValue,
  type Firestore,
  initializeFirestore,
  Timestamp,
} from 'firebase-admin/firestore';
import { getApp } from './app.ts';

let _firestore: Firestore | undefined;

export const getFirestore = (): Firestore => {
  if (_firestore) {
    return _firestore;
  }
  const app = getApp();
  const preferRest = true;
  _firestore = initializeFirestore(app, { preferRest });

  return _firestore;
};

export const serverTimestamp = () => FieldValue.serverTimestamp();
export const serverIncrement = (n: number) => FieldValue.increment(n);
export const serverDelete = () => FieldValue.delete();
export const timestampFromDate = (date: Date) => Timestamp.fromDate(date);
export const documentId = () => FieldPath.documentId();
export const arrayUnion = (...elements: unknown[]) => FieldValue.arrayUnion(...elements);
export const arrayRemove = (...elements: unknown[]) => FieldValue.arrayRemove(...elements);
export const timestampNow = () => Timestamp.now();

export const getXDaysFromNowTimestamp = (days: number): Timestamp => {
  return timestampFromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
};
