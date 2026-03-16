// apps/backend/functions/scripts/on_emulate.ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getAuth } from '@aikami/backend/configs/auth';
import { serverTimestamp } from '@aikami/backend/configs/firestore';
import { personaRepository } from '@aikami/backend/database/persona';
import { setUserData } from '@aikami/backend/database/user';
import { uploadToFirebase } from '@aikami/backend/utils/storage';

import { npcRepository } from '@aikami/backend-database';
import { DEFAULT_SAVING_THROWS, DEFAULT_SKILLS } from '@aikami/schemas';
import type { NpcCreateData, PersonaCreateData, UserCreateData } from '@aikami/types';
import { logger } from '$logger';

const EMULATOR_PASSWORD = 'asdasd';

const ASSETS_DIR = join(__dirname, '../assets');

type NpcWithExpressions = NpcCreateData & {
  expressions?: Record<string, string>;
};

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

const npcs: NpcWithExpressions[] = [
  {
    name: 'aragon',
    race: 'Human',
    class: 'Ranger',
    level: 15,
    experiencePoints: 100000,
    abilityScores: {
      strength: 18,
      dexterity: 16,
      constitution: 16,
      intelligence: 14,
      wisdom: 15,
      charisma: 16,
    },
    hitPoints: 150,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 18,
    speed: 30,
    alignment: 'Lawful Good',
    background: 'Noble',
    proficiencies: ['Longsword', 'Bow', 'Survival', 'Athletics'],
    languages: ['Common', 'Elvish', 'Sindarin'],
    equipment: ['Andúril', 'Bow', 'Elven Cloak'],
    inventory: ['Andúril', 'Bow', 'Elven Cloak'],
    isFriendly: true,
    visibility: 'public',
  },
  {
    name: 'Gandalf',
    race: 'Maiar',
    class: 'Wizard',
    level: 20,
    experiencePoints: 355000,
    abilityScores: {
      strength: 14,
      dexterity: 14,
      constitution: 16,
      intelligence: 20,
      wisdom: 20,
      charisma: 18,
    },
    hitPoints: 120,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 12,
    speed: 30,
    alignment: 'Lawful Good',
    background: 'Sage',
    proficiencies: ['Staff', 'Arcana', 'History', 'Insight'],
    languages: ['Common', 'Elvish', 'Valarin'],
    equipment: ["Wizard's Staff", 'Glamdring', 'Narya'],
    inventory: ["Wizard's Staff", 'Glamdring', 'Narya'],
    isFriendly: true,
    visibility: 'public',
  },
  {
    name: 'Orc',
    race: 'Orc',
    class: 'Barbarian',
    level: 5,
    experiencePoints: 6500,
    abilityScores: {
      strength: 18,
      dexterity: 12,
      constitution: 16,
      intelligence: 8,
      wisdom: 10,
      charisma: 8,
    },
    hitPoints: 60,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 13,
    speed: 30,
    alignment: 'Chaotic Evil',
    background: 'Soldier',
    proficiencies: ['Greataxe', 'Intimidation', 'Athletics'],
    languages: ['Common', 'Orc'],
    equipment: ['Greataxe', 'Javelins', 'Leather Armor'],
    inventory: ['Greataxe', 'Javelins', 'Leather Armor', 'Trophy Teeth'],
    isFriendly: false,
    visibility: 'public',
  },
  {
    name: 'Troll',
    race: 'Troll',
    class: 'Monk',
    level: 8,
    experiencePoints: 24000,
    abilityScores: {
      strength: 20,
      dexterity: 14,
      constitution: 18,
      intelligence: 6,
      wisdom: 12,
      charisma: 6,
    },
    hitPoints: 95,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 14,
    speed: 40,
    alignment: 'Chaotic Evil',
    background: 'Outlander',
    proficiencies: ['Unarmed Strike', 'Intimidation', 'Survival'],
    languages: ['Common', 'Orc'],
    equipment: ['Claws (natural)', 'Greatclub'],
    inventory: ['Claws (natural)', 'Greatclub', 'Goblin Ears'],
    isFriendly: false,
    visibility: 'public',
  },
];

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

const createUserDocument = async (uid: string, email: string, displayName: string) => {
  const userData: UserCreateData = {
    email: email.toLowerCase(),
    displayName,
    agreedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    signInProviders: [],
    userRole: 'member',
  };
  await setUserData(uid, userData);
};

const createPersona = async (uid: string): Promise<string> => {
  const personaData: PersonaCreateData = {
    uid,
    name: 'Test User',
    race: 'Human',
    class: 'Wizard',
    level: 1,
    experiencePoints: 0,
    abilityScores: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    hitPoints: 10,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 10,
    speed: 30,
    alignment: 'Neutral',
    background: 'Sage',
    proficiencies: [],
    languages: ['Common'],
    equipment: [],
    inventory: [],
    isActive: true,
  };

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
      const npcData = npcs.find(
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

const createEmulatorUser = async (email: string, displayName: string) => {
  const auth = getAuth();
  try {
    const userRecord = await auth.createUser({
      email,
      password: EMULATOR_PASSWORD,
      displayName,
    });

    const uid = userRecord.uid;
    await createUserDocument(uid, email, displayName);
    await createPersona(uid);
    logger.log(`Created user: ${email} (${uid})`);
    return uid;
  } catch (error) {
    logger.error(`Error creating user ${email}:`, error);
    return undefined;
  }
};

logger.log('Starting emulation...');

await deleteAllEmulatorUsers();

await createNpcs();

await createEmulatorUser('admin@example.com', 'Admin User');
await createEmulatorUser('user@example.com', 'Regular User');

logger.log('Emulation complete!');
