import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Firestack runs this script automatically when the emulator starts.
 * Use it to seed data into your local emulators.
 */
async function run() {
  const projectId = process.env.FIREBASE_PROJECT_ID || "demo-project";
  console.log(`Initializing emulators for project: ${projectId}`);

  const app = initializeApp({ projectId });
  const db = getFirestore(app);

  // Seed example
  await db.collection("system").doc("status").set({
    ready: true,
    seededAt: new Date().toISOString(),
  });

  console.log("✅ Emulator seeded successfully!");
}

if (import.meta.main) {
  run().catch(console.error);
}

export default run;
