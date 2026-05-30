// packages/frontend/configs/src/lib/storage.ts
import { connectStorageEmulator, type FirebaseStorage, getStorage } from 'firebase/storage';

import app from './app.ts';
import { EMULATOR_PORTS, isEmulatorModePublic } from './environment.ts';

export {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';

export const initializeStorageInstance = (): FirebaseStorage => {
  const instance = getStorage(app);

  if (isEmulatorModePublic()) {
    connectStorageEmulator(instance, 'localhost', EMULATOR_PORTS.storage);
  }

  return instance;
};

export const storage = initializeStorageInstance();
