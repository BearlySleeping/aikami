// apps/backend/firebase/scripts/on_emulate.ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getAuth } from '@aikami/backend/configs/auth';
import { serverTimestamp } from '@aikami/backend/configs/firestore';
import { npcRepository } from '@aikami/backend/database/npc';
import { personaRepository } from '@aikami/backend/database/persona';
import { setUserData } from '@aikami/backend/database/user';
import { uploadToFirebase } from '@aikami/backend/utils/storage';
import {
  EMULATOR_NPCS,
  EMULATOR_PASSWORD,
  EMULATOR_PERSONA_DATA,
  EMULATOR_USERS,
} from '@aikami/mocks';

import type { NpcCreateData, PersonaCreateData, UserCreateData } from '@aikami/types';
import { logger } from '$logger';

const ASSETS_DIR = join(__dirname, '../assets');

async function uploadNpcImages(npcDir: string): Promise<Record<string, string>> {
  const expressions: Record<string, string> = {};

  try {
    const files = await readdir(npcDir);
    for (const file of files) {
      if (file.endsWith('.webp') || file.endsWith('.png') || file.endsWith('.jpg')) {
        const expression = file.replace('.webp', '').replace('.png', '').replace('.jpg', '');
        const filePath = join(npcDir, file);
        const destination = `npc/${npcDir.split('/').pop()}/${file}`;
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

const createPersona = async (uid: string): Promise<string> => {
  const personaData: PersonaCreateData = {
    ...EMULATOR_PERSONA_DATA,
    uid,
  } as PersonaCreateData;

  const id = await personaRepository.addDocument({
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

      const expressions = await uploadNpcImages(join(npcImagesDir, npcDir));

      const npcWithExpressions: NpcCreateData = {
        ...npcData,
        expressions,
        avatarUrl: expressions.neutral || expressions.happy || Object.values(expressions)[0],
      };

      const id = await npcRepository.addDocument({
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

logger.log('Starting emulation...');

await deleteAllEmulatorUsers();

await createNpcs();

for (const user of EMULATOR_USERS) {
  await createEmulatorUser(user.email, user.displayName, user.userRole);
}

logger.log('Emulation complete!');
