// apps/backend/functions/scripts/on_emulate.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAuth } from '@aikami/backend/configs/auth';
import { getBucket } from '@aikami/backend/configs/bucket';
import { serverTimestamp } from '@aikami/backend/configs/firestore';
import { messageRepository } from '@aikami/backend/database/message';
import { personaRepository } from '@aikami/backend/database/persona';
import { setUserData } from '@aikami/backend/database/user';
import { createFirebaseAuthUser } from '@aikami/backend/utils/auth';
import { npcRepository } from '@aikami/backend-database';
import { DEFAULT_SAVING_THROWS, DEFAULT_SKILLS } from '@aikami/schemas';
import type {
  MessageCreateData,
  NpcCreateData,
  PersonaCreateData,
  UserCreateData,
} from '@aikami/types';
import { logger } from '$logger';

const EMULATOR_PASSWORD = 'asdasd';

const ASSETS_DIR = join(__dirname, '../assets');

const storageAssets = [
  {
    fileName: 'image.avif',
    destinationPath: 'images/avatar-default.avif',
    contentType: 'image/avif',
  },
];

const npcs: NpcCreateData[] = [
  {
    name: 'Aragorn',
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
  },
  {
    name: 'Legolas',
    race: 'Elf',
    class: 'Fighter',
    level: 15,
    experiencePoints: 100000,
    abilityScores: {
      strength: 14,
      dexterity: 20,
      constitution: 14,
      intelligence: 14,
      wisdom: 16,
      charisma: 16,
    },
    hitPoints: 130,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 17,
    speed: 35,
    alignment: 'Chaotic Good',
    background: 'Outlander',
    proficiencies: ['Longbow', 'Shortsword', 'Acrobatics', 'Perception'],
    languages: ['Common', 'Elvish'],
    equipment: ['Bow of the Galadhrim', 'White Knives'],
    inventory: ['Bow of the Galadhrim', 'White Knives'],
    isFriendly: true,
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
  const persona: PersonaCreateData = {
    name: 'Aria the Bard',
    race: 'Half-Elf',
    class: 'Bard',
    level: 10,
    experiencePoints: 64000,
    abilityScores: {
      strength: 10,
      dexterity: 14,
      constitution: 12,
      intelligence: 13,
      wisdom: 10,
      charisma: 18,
    },
    hitPoints: 80,
    temporaryHitPoints: 0,
    savingThrows: DEFAULT_SAVING_THROWS,
    skills: DEFAULT_SKILLS,
    armorClass: 14,
    speed: 30,
    alignment: 'Chaotic Good',
    background: 'Entertainer',
    proficiencies: ['Viol', 'Dagger', 'Performance', 'Persuasion'],
    languages: ['Common', 'Elvish', 'Draconic'],
    equipment: ['Viol', 'Costume', "Traveler's Clothes"],
    inventory: ['Viol', 'Costume', "Traveler's Clothes", '10 GP'],
    personalityTraits: 'Always humming a tune, speaks in poetic verses',
    ideals: 'Beauty and art are worth protecting',
    bonds: 'Owes a debt to a mysterious patron',
    flaws: 'Cannot resist a gamble',
    uid,
    isActive: true,
    createdAt: serverTimestamp(),
  };

  const personaId = await personaRepository.addDocument({
    createData: persona,
    getCollectionPathArgument: { uid },
  });
  return personaId;
};

const createChat = async (uid: string, personaId: string) => {
  const persona = await personaRepository.getDocument({
    uid,
    personaId,
  });

  if (!persona) {
    throw new Error(`Persona ${personaId} not found`);
  }

  const chatId = `chat_${Date.now()}`;

  const initialMessage: MessageCreateData = {
    text: 'Hello! I am Aria, a traveling bard. Would you like to hear a tale?',
    sender: 'ai',
    createdAt: serverTimestamp(),
  };

  await messageRepository.addDocument({
    createData: initialMessage,
    getCollectionPathArgument: { uid },
  });

  return chatId;
};

type StorageAsset = {
  fileName: string;
  destinationPath: string;
  contentType: string;
};

const uploadAssetToStorage = async (asset: StorageAsset): Promise<string> => {
  const bucket = getBucket();
  const filePath = join(ASSETS_DIR, asset.fileName);

  try {
    const fileContent = await readFile(filePath);
    const file = bucket.file(asset.destinationPath);

    await file.save(fileContent, {
      metadata: {
        contentType: asset.contentType,
      },
    });

    logger.log(`Uploaded ${asset.fileName} to ${asset.destinationPath}`);
    return asset.destinationPath;
  } catch (error) {
    logger.error(`Failed to upload ${asset.fileName}:`, error);
    throw error;
  }
};

const seedStorage = async (assets: StorageAsset[]) => {
  logger.log('Seeding storage with images...');
  const uploadedPaths: string[] = [];

  for (const asset of assets) {
    const path = await uploadAssetToStorage(asset);
    uploadedPaths.push(path);
  }

  logger.log(`✅ Seeded ${uploadedPaths.length} storage assets`);
  return uploadedPaths;
};

logger.log('Creating NPCs...');
for (const npc of npcs) {
  const id = await npcRepository.addDocument({
    createData: npc,
    getCollectionPathArgument: {},
  });
  logger.log(`Created NPC ${npc.name} with id: ${id}`);
}

logger.log('Clearing existing emulator users...');
await deleteAllEmulatorUsers();

logger.log('Creating email/password users...');

const authorizedUid = await createFirebaseAuthUser({
  uid: 'authorized_user',
  displayName: 'Authorized User',
  email: 'authorized@bearlysleeping.com',
  password: EMULATOR_PASSWORD,
});
await createUserDocument(authorizedUid, 'authorized@bearlysleeping.com', 'Authorized User');
logger.log('Created authorized user (registered)');

logger.log('Creating persona and chat for authorized user...');
const personaId = await createPersona(authorizedUid);
logger.log(`Created persona: ${personaId}`);

const chatId = await createChat(authorizedUid, personaId);
logger.log(`Created chat: ${chatId}`);

await seedStorage(storageAssets);

logger.log('✅ Emulator seeded!');
logger.log('');
logger.log('Auth Users:');
logger.log('  Authorized: authorized@bearlysleeping.com / asdasd');
