import {
  connectFirestoreEmulator,
  type Firestore,
  initializeFirestore,
  Timestamp,
} from 'firebase/firestore';
import app from './app.ts';

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
} from 'firebase/firestore';

let _firestore: Firestore | undefined;

const getFirestore = () => {
  if (_firestore) {
    return _firestore;
  }
  _firestore = initializeFirestore(app, {
    ignoreUndefinedProperties: import.meta.env.PUBLIC_FLAVOR === 'production',
    localCache:
      import.meta.env.PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE === '1'
        ? {
            kind: 'persistent',
          }
        : undefined,
  });

  if (import.meta.env.PUBLIC_FLAVOR === 'EMULATOR') {
    connectFirestoreEmulator(_firestore, 'localhost', 8080);
  }

  return _firestore;
};

const firestore = getFirestore();

export { firestore, Timestamp };
