// apps/backend/firebase/scripts/on_emulate.ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getAuth } from '@aikami/backend/configs/auth';
import { serverTimestamp } from '@aikami/backend/configs/firestore';
import { npcFirestoreRepository } from '@aikami/backend/firestore/npc';
import { personaFirestoreRepository } from '@aikami/backend/firestore/persona';
import { setUserData } from '@aikami/backend/firestore/user';
import { uploadToFirebase } from '@aikami/backend/utils/storage';
import {
  EMULATOR_GOOGLE_PERSONA_DATA,
  EMULATOR_GOOGLE_USERS,
  EMULATOR_NPCS,
  EMULATOR_PASSWORD,
  EMULATOR_PERSONA_DATA,
  EMULATOR_USERS,
} from '@aikami/mocks';

import type { NpcCreateData, PersonaCreateData, UserCreateData } from '@aikami/types';
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

const createPersona = async (
  uid: string,
  data?: Omit<PersonaCreateData, 'uid'>,
): Promise<string> => {
  const personaData: PersonaCreateData = {
    ...(data ?? EMULATOR_PERSONA_DATA),
    uid,
  } as PersonaCreateData;

  const id = await personaFirestoreRepository.addDocument({
    getCollectionPathArgument: { uid },
    createData: personaData,
  });
  return id;
};

const createNpcs = async () => {
  const npcImagesDir = join(ASSETS_DIR, 'images/npc');
  logger.log('Creating NPCs with images...');

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

      // Use npcDir as the id for consistent path structure in Storage
      const npcId = npcDir.toLowerCase();
      const expressions = await uploadNpcImages(
        join(npcImagesDir, npcDir),
        npcId,
        'emulator-admin',
      );

      const npcWithExpressions: NpcCreateData = {
        ...npcData,
        expressions,
        avatarUrl: expressions.neutral || expressions.happy || Object.values(expressions)[0],
      };

      const id = await npcFirestoreRepository.addDocument({
        getCollectionPathArgument: {} as Record<string, never>,
        createData: npcWithExpressions,
      });
      logger.log(`Created NPC: ${npcData.name} (${id})`);
    }
  } catch (error) {
    logger.error('Error creating NPCs:', error);
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

    // Inject custom claims: userRole + tenant mapping
    await auth.setCustomUserClaims(uid, {
      userRole,
    });

    // Create Firestore user document via the domain repository helper
    const userData: UserCreateData = {
      agreedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      displayName,
      email: email.toLowerCase(),
      signInProviders: [],
      userRole,
    };
    await setUserData(uid, userData);
    await createPersona(uid);

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
 * - **Pre-existing users** (`preExisting: true`) — get an Auth account,
 *   Firestore user document, and a populated persona (returning player flow).
 * - **Fresh users** (`preExisting: false`) — get ONLY an Auth account with
 *   no Firestore doc or persona (new player onboarding flow).
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

    // Create Firestore documents + personas for pre-existing (returning) users only.
    // Fresh users have ONLY an Auth account — no Firestore doc, no persona.
    for (const user of EMULATOR_GOOGLE_USERS) {
      const uid = `google-${user.email.replace(/[^a-zA-Z0-9]/g, '-')}`;

      if (user.preExisting) {
        const userData: UserCreateData = {
          agreedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          displayName: user.displayName,
          email: user.email.toLowerCase(),
          signInProviders: ['google'],
          userRole: user.userRole,
        };
        await setUserData(uid, userData);
        await createPersona(uid, EMULATOR_GOOGLE_PERSONA_DATA);

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

await createNpcs();

for (const user of EMULATOR_USERS) {
  await createEmulatorUser(user.email, user.displayName, user.userRole);
}

// Import Google-simulated users for emulator OAuth sign-in
await importGoogleEmulatorUsers();

logger.log('Emulation complete!');
