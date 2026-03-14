import { connectStorageEmulator, getStorage } from 'firebase/storage';

import app from './app.ts'; // Assuming this path exports your initialized Firebase app

// Re-export the core storage functions you'll need throughout your app.
// This pattern makes it easy to use them from the dynamically imported module.
export {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';

// Initialize Firebase Storage.
// You can optionally pass a default bucket URL, e.g., getStorage(app, 'gs://my-bucket.appspot.com');
export const storage = getStorage(app);

if (import.meta.env.PUBLIC_FLAVOR === 'EMULATOR') {
  connectStorageEmulator(storage, 'localhost', 9199);
}
