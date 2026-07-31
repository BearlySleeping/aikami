import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * Firestack runs this script automatically when the emulator starts.
 * Use it to seed data into your local emulators.
 */
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  throw new Error('FIREBASE_PROJECT_ID environment variable not set');
}

const mode = process.env.FIREBASE_MODE;
console.log(`Initializing emulator (Project: ${projectId}, Mode: ${mode})...`);

const app = initializeApp({
  projectId,
  storageBucket: `${projectId}.firebasestorage.app`,
});

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// 1. Seed Auth users
console.log('Creating sample users...');
try {
  await auth.createUser({
    uid: 'user1',
    email: 'john@example.com',
    password: 'password123',
    displayName: 'John Doe',
  });
} catch (error) {
  const e = error as { code?: string };
  if (e.code !== 'auth/uid-already-exists') {
    console.error('Error creating user:', error);
  }
}

// 2. Seed Firestore
console.log('Seeding Firestore...');
await db.collection('users').doc('user1').set({
  name: 'John Doe',
  email: 'john@example.com',
  createdAt: new Date(),
});

await db.collection('system').doc('status').set({
  ready: true,
  seededAt: new Date().toISOString(),
});

// 3. Seed Storage (optional — uncomment and customize)
// const bucket = storage.bucket();
// await bucket.file('assets/sample.txt').save('Hello, world!', {
//   metadata: { contentType: 'text/plain' },
// });

console.log('Emulator seeded successfully.');
