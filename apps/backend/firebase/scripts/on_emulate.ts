// apps/backend/firebase/scripts/on_emulate.ts
//
// Emulator seeding (C-386 AC-11): creates Auth users only — zero Firestore
// writes. Personas, NPCs, and custom agents are seeded client-side into the
// local SQLite tables by emulatorSeedService (the emulator process cannot
// reach the browser's OPFS-backed database). NPC images still upload to the
// Storage emulator (Storage is out of scope for the Firestore removal).
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getAuth } from '@aikami/backend/configs/auth';
import { uploadToFirebase } from '@aikami/backend/utils/storage';
import {
  EMULATOR_GOOGLE_USERS,
  EMULATOR_NPCS,
  EMULATOR_PASSWORD,
  EMULATOR_USERS,
} from '@aikami/mocks';

import type { UserCreateData } from '@aikami/types';
import { logger } from '$logger';

const ASSETS_DIR = join(__dirname, '../assets');

async function uploadNpcImages(
  npcDir: string,
  npcId: string,
  creatorUid: string = 'emulator-admin',
): Promise<Record<string, string>> {
  const expressions: Record<string, string> = {};

  try {
    const files = await readdir(npcDir);
    for (const file of files) {
      if (file.endsWith('.webp') || file.endsWith('.png') || file.endsWith('.jpg')) {
        const expression = file.replace('.webp', '').replace('.png', '').replace('.jpg', '');
        const filePath = join(npcDir, file);
        const destination = `npcs/${creatorUid}/${npcId}/${file}`;
        const contentType = file.endsWith('.png') ? 'image/png' : 'image/webp';

        try {
          const url = await uploadToFirebase({
            filePath,
            destination,
            contentType,
          });
          expressions[expression] = url;
          logger.log(`Uploaded ${expression}: ${url}`);
        } catch (e) {
          logger.error(`Failed to upload ${file}:`, e);
        }
      }
    }
  } catch {
    logger.warn(`No images found for NPC: ${npcDir}`);
  }

  return expressions;
}

const deleteAllEmulatorUsers = async () => {
  const auth = getAuth();
  try {
    const users = await auth.listUsers();
    for (const user of users.users) {
      await auth.deleteUser(user.uid);
    }
    logger.log('Cleared all emulator users');
  } catch (error) {
    logger.error('Error clearing users:', error);
  }
};

/**
 * Uploads NPC expression images to the Storage emulator so seeded local NPCs
 * (created client-side by emulatorSeedService) have avatar/expression URLs.
 * Storage is untouched by the Firestore removal (C-386 out of scope).
 */
const uploadNpcAssets = async () => {
  const npcImagesDir = join(ASSETS_DIR, 'images/npc');
  logger.log('Uploading NPC images...');

  try {
    const npcDirs = await readdir(npcImagesDir);
    logger.log(`Found NPC directories: ${npcDirs.join(', ')}`);

    for (const npcDir of npcDirs) {
      const npcData = EMULATOR_NPCS.find(
        (n) => n.name.toLowerCase().replace(' ', '-') === npcDir.toLowerCase(),
      );

      if (!npcData) {
        logger.warn(`No NPC data found for directory: ${npcDir}`);
        continue;
      }

      // Use npcDir as the id for consistent path structure in Storage.
      const npcId = npcDir.toLowerCase();
      await uploadNpcImages(join(npcImagesDir, npcDir), npcId, 'emulator-admin');
    }
  } catch (error) {
    logger.error('Error uploading NPC images:', error);
  }
};

const createEmulatorUser = async (
  email: string,
  displayName: string,
  userRole: UserCreateData['userRole'] = 'member',
): Promise<{ uid: string; email: string; displayName: string } | undefined> => {
  const auth = getAuth();
  try {
    const userRecord = await auth.createUser({
      email,
      password: EMULATOR_PASSWORD,
      displayName,
    });

    const uid = userRecord.uid;

    // Inject custom claims: userRole + tenant mapping. The Firestore user
    // document was deleted (C-386 OQ1) — claims live on the Auth record.
    await auth.setCustomUserClaims(uid, {
      userRole,
    });

    logger.log(`Created user: ${email} (${uid})`);
    return { uid, email: email.toLowerCase(), displayName };
  } catch (error) {
    logger.error(`Error creating user ${email}:`, error);
    return undefined;
  }
};

// ── Google-simulated users for emulator OAuth sign-in ────────────────────

/**
 * Pre-imports Google-authenticated users into the Auth emulator.
 *
 * The Firebase Auth emulator cannot perform a real Google OAuth handshake.
 * Instead, we simulate Google sign-in by pre-importing users with a
 * {@link https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.userimportrecord.md#userimportrecordproviderdata | google.com providerData}
 * record. The emulator popup UI then presents these accounts as selectable
 * Google identities.
 *
 * Strategy:
 * - **Pre-existing users** (`preExisting: true`) — get an Auth account with
 *   a populated persona (the persona itself is seeded client-side; the Auth
 *   account and claims are created here).
 * - **Fresh users** (`preExisting: false`) — get ONLY an Auth account
 *   (new player onboarding flow).
 */
const importGoogleEmulatorUsers = async () => {
  const auth = getAuth();

  const records = EMULATOR_GOOGLE_USERS.map((user) => ({
    uid: `google-${user.email.replace(/[^a-zA-Z0-9]/g, '-')}`,
    email: user.email,
    displayName: user.displayName,
    providerData: [
      {
        providerId: 'google.com',
        uid: user.email,
        email: user.email,
        displayName: user.displayName,
      },
    ],
    customClaims: { userRole: user.userRole },
  }));

  try {
    const result = await auth.importUsers(records);

    logger.log(
      `Imported ${result.successCount} Google-simulated users (${result.failureCount} failed)`,
    );

    if (result.errors.length > 0) {
      for (const error of result.errors) {
        logger.error(`Google user import error [${error.index}]:`, error.error.message);
      }
    }

    for (const user of EMULATOR_GOOGLE_USERS) {
      const uid = `google-${user.email.replace(/[^a-zA-Z0-9]/g, '-')}`;
      if (user.preExisting) {
        logger.log(`Created returning Google user: ${user.email} (${uid}) with persona`);
      } else {
        logger.log(
          `Created fresh Google user: ${user.email} (${uid}) — Auth only, no Firestore doc`,
        );
      }
    }
  } catch (error) {
    logger.error('Error importing Google users:', error);
  }
};

// ── Main emulation flow ─────────────────────────────────────────────────────

logger.log('Starting emulation...');

await deleteAllEmulatorUsers();

await uploadNpcAssets();

for (const user of EMULATOR_USERS) {
  await createEmulatorUser(user.email, user.displayName, user.userRole);
}

// Import Google-simulated users for emulator OAuth sign-in
await importGoogleEmulatorUsers();

logger.log(
  'Emulation complete! Local personas/NPCs/custom agents are seeded client-side ' +
    '(emulatorSeedService) on first app boot in emulator mode.',
);
