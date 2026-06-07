// apps/frontend/pwa/src/lib/client/game/services/index.ts

export type { FirebaseAuthInterface, FirebaseUser } from './firebase/auth.ts';
export { getFirebaseAuth } from './firebase/auth.ts';
export type { FirebaseConfig } from './firebase/config.ts';
export { getConfig } from './firebase/config.ts';
export type { FirebaseAppInterface } from './firebase/firebase_app.ts';
export {
  createFirebase,
  getFirebase,
} from './firebase/firebase_app.ts';
export type { FirebaseFirestoreInterface } from './firebase/firestore.ts';
export { getFirebaseFirestore } from './firebase/firestore.ts';
export type { FirebaseFunctionsInterface } from './firebase/functions.ts';
export { getFirebaseFunctions } from './firebase/functions.ts';
export type { FirebaseHttpClientInterface, HttpResult } from './firebase/http_client.ts';
export { getFirebaseHttpClient } from './firebase/http_client.ts';
export type { FirebaseStorageInterface } from './firebase/storage.ts';
export { getFirebaseStorage } from './firebase/storage.ts';
