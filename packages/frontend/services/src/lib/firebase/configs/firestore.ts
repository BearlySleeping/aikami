// packages/frontend/services/src/lib/firebase/configs/firestore.ts
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

const getFirestoreInstance = (): Firestore => {
  if (_firestore) {
    return _firestore;
  }

  // Use getFirestore() without arguments - it auto-uses the default app
  // This works because app.ts is imported above which initializes the app
  _firestore = getFirestore();

  // Connect to emulator - only do this once
  if (import.meta.env.PUBLIC_FLAVOR === 'EMULATOR' && !_emulatorConnected) {
    connectFirestoreEmulator(_firestore, 'localhost', 8080);
    _emulatorConnected = true;
  }

  return _firestore;
};

export type { Firestore };
export { getFirestoreInstance, Timestamp };
