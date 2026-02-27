import {
  type Firestore,
  initializeFirestore as fbInitializeFirestore,
} from 'firebase-admin/firestore';
import { getApp } from './app.ts';

// import { getEnvironmentValue } from './environment.ts';

let _database: Firestore | undefined;

export const getFirestore = (): Firestore => {
  if (_database) {
    return _database;
  }
  const app = getApp();
  const isDeno = true; //!!getEnvironmentValue('DENO_VERSION' , true);
  _database = fbInitializeFirestore(app, { preferRest: isDeno });

  return _database;
};
