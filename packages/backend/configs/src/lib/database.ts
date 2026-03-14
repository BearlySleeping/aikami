import process from 'node:process';
import {
  type Firestore,
  initializeFirestore as fbInitializeFirestore,
} from 'firebase-admin/firestore';
import { getApp } from './app.ts';

// import { getEnvironmentValue } from './environment.ts';

let _database: Firestore | undefined;
let _lastEmulatorState: boolean | undefined;

export const getFirestore = (): Firestore => {
  const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

  // Reset database if switching between emulator and production
  if (_database && _lastEmulatorState !== isEmulator) {
    _database = undefined;
  }
  _lastEmulatorState = isEmulator;

  if (_database) {
    return _database;
  }
  const app = getApp();
  const isDeno = true; //!!getEnvironmentValue('DENO_VERSION' , true);
  _database = fbInitializeFirestore(app, { preferRest: isDeno });

  // Explicitly connect to emulator if FIRESTORE_EMULATOR_HOST is set
  if (isEmulator) {
    const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    console.log(`[database.ts] Connecting to Firestore emulator at ${host}`);
    _database.settings({
      host: host,
      ssl: false,
    });
  }

  return _database;
};
