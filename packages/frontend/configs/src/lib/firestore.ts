// packages/frontend/configs/src/lib/firestore.ts
import { connectFirestoreEmulator, type Firestore, initializeFirestore } from 'firebase/firestore';
import app from './app';
import {
  EMULATOR_PORTS,
  isDevelopmentModePublic,
  isEmulatorModePublic,
  publicEnv,
} from './environment';

export type { Firestore } from 'firebase/firestore';
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
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const initializeFirestoreInstance = (): Firestore => {
  const instance = initializeFirestore(app, {
    ignoreUndefinedProperties: !isDevelopmentModePublic(),
    localCache:
      publicEnv.PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE === '1'
        ? { kind: 'persistent' }
        : undefined,
  });

  // Connect to emulator — only do this once
  if (isEmulatorModePublic()) {
    connectFirestoreEmulator(instance, 'localhost', EMULATOR_PORTS.firestore);
  }

  return instance;
};

// Eagerly initialize — the single DOMException: AbortError that fires on SSR
// is a harmless Firestore SDK internal WebChannel abort (auth token resolves
// moments after the initial WebChannel starts). This is a known Firebase SDK
// behavior and does not affect functionality.
export const firestore = initializeFirestoreInstance();
