// packages/frontend/configs/src/lib/firestore.ts
import './app.ts'; // Ensure app is initialized first
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  type Firestore,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { isEmulatorMode } from './environment';

export {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
};

let _firestore: Firestore | undefined;
let _emulatorConnected = false;

export const getFirestoreInstance = (): Firestore => {
  if (_firestore) {
    return _firestore;
  }

  _firestore = getFirestore();

  if (isEmulatorMode() && !_emulatorConnected) {
    connectFirestoreEmulator(_firestore, 'localhost', 8080);
    _emulatorConnected = true;
  }

  return _firestore;
};

export type { Firestore };
export { Timestamp };
