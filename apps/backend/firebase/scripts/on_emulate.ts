// apps/backend/firebase/scripts/on_emulate.ts
import { existsSync } from 'node:fs';
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

// ── Audio asset upload to Firebase Storage emulator ────────────────────────

/**
 * Uploads all audio assets from {@link ASSETS_DIR}/audio/ to Firebase Storage
 * and returns a flat map of filename → download URL.
 *
 * Walks the `music/` and `sfx/` subdirectories recursively. Each file is
 * uploaded to `audio/{subdir}/{filename}` in the default Storage bucket.
 *
 * @returns A Map keyed by bare filename (e.g. 'bgm_combat.webm') to its
 *          emulator download URL.
 */
const uploadAudioAssets = async (): Promise<Map<string, string>> => {
  const audioDir = join(ASSETS_DIR, 'audio');
  const urlMap = new Map<string, string>();

  if (!existsSync(audioDir)) {
    logger.warn('Audio assets directory not found, skipping upload', {
      expectedPath: audioDir,
    });
    return urlMap;
  }

  const subdirs = ['music', 'sfx'];

  for (const subdir of subdirs) {
    const dirPath = join(audioDir, subdir);
    if (!existsSync(dirPath)) {
      continue;
    }

    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      logger.warn(`Cannot read audio/${subdir}, skipping`);
      continue;
    }

    for (const file of files) {
      const filePath = join(dirPath, file);
      const destination = `audio/${subdir}/${file}`;
      const ext = file.split('.').pop()?.toLowerCase();
      const contentType =
        ext === 'webm'
          ? 'audio/webm'
          : ext === 'wav'
            ? 'audio/wav'
            : ext === 'mp3'
              ? 'audio/mpeg'
              : ext === 'ogg'
                ? 'audio/ogg'
                : 'application/octet-stream';

      try {
        const url = await uploadToFirebase({
          filePath,
          destination,
          contentType,
        });
        urlMap.set(file, url);
        logger.log(`Uploaded audio: ${destination} → ${url.slice(0, 80)}…`);
      } catch (error) {
        logger.error(`Failed to upload audio: ${file}`, error);
      }
    }
  }

  logger.log(`Audio upload complete: ${urlMap.size} files`);
  return urlMap;
};

// ── Data Connect PostgreSQL emulator seeding ───────────────────────────────

/**
 * Seeds the Data Connect emulator's PostgreSQL database with {@link AudioTrack}
 * rows, mapping musical moods to uploaded audio file URLs.
 *
 * Connects to the PostgreSQL instance exposed by the Data Connect emulator
 * (default port 9399) and executes:
 * 1. CREATE TABLE IF NOT EXISTS — matches the schema.gql {@link AudioTrack} type
 * 2. INSERT rows for each mood→URL mapping
 *
 * @param audioUrls - Map of filename → Storage download URL from
 *   {@link uploadAudioAssets}.
 */
const seedAudioTracks = async (audioUrls: Map<string, string>): Promise<void> => {
  if (audioUrls.size === 0) {
    logger.warn('No audio URLs to seed — skipping Data Connect AudioTrack seeding');
    return;
  }

  const pgHost = process.env.PGHOST ?? '127.0.0.1';
  const pgPort = Number.parseInt(process.env.PGPORT ?? '5432', 10);
  const pgDatabase = process.env.PGDATABASE ?? 'fdcdb';
  const pgUser = process.env.PGUSER ?? 'postgres';
  const pgPassword = process.env.PGPASSWORD ?? '';

  // Dynamic import — avoids pulling in pg at module load time (test environments)
  const { Client } = await import('pg');
  const client = new Client({
    host: pgHost,
    port: pgPort,
    database: pgDatabase,
    user: pgUser,
    password: pgPassword,
  });

  try {
    await client.connect();
    logger.log(`Connected to Data Connect PostgreSQL at ${pgHost}:${pgPort}/${pgDatabase}`);

    // Clean up any stale manually-created table from previous runs
    await client.query('DROP TABLE IF EXISTS "AudioTrack"').catch(() => {});

    // The Data Connect emulator auto-creates audio_track (snake_case) from schema.gql.
    // Columns: id (UUID), title, mood, storage_url
    // If the table doesn't exist yet (emulator just started), wait briefly and retry.
    let tableReady = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const exists = await client.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audio_track')",
      );
      if (exists.rows[0]?.exists === true) {
        tableReady = true;
        break;
      }
      logger.log(
        `Waiting for Data Connect to create audio_track table (attempt ${attempt + 1}/5)...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!tableReady) {
      logger.error(
        'audio_track table not found after retries — Data Connect may not have initialized schema',
      );
      return;
    }

    logger.log('audio_track table ready');

    // Clear stale rows from previous runs (URLs may have changed)
    await client.query('DELETE FROM audio_track');

    // Map filenames to (mood, title) pairs
    const trackMappings: Array<{ file: string; mood: string; title: string }> = [
      { file: 'bgm_combat.webm', mood: 'epic', title: 'Combat BGM' },
      { file: 'bgm_combat.webm', mood: 'tense', title: 'Combat BGM' },
      { file: 'bgm_combat.webm', mood: 'heroic', title: 'Combat BGM' },
      { file: 'bgm_combat.webm', mood: 'foreboding', title: 'Combat BGM' },
      { file: 'bgm_explore.webm', mood: 'triumph', title: 'Explore BGM' },
      { file: 'bgm_explore.webm', mood: 'sorrow', title: 'Explore BGM' },
      { file: 'bgm_explore.webm', mood: 'mysterious', title: 'Explore BGM' },
      { file: 'bgm_explore.webm', mood: 'peaceful', title: 'Explore BGM' },
    ];

    let inserted = 0;
    for (const { file, mood, title } of trackMappings) {
      const storageUrl = audioUrls.get(file);
      if (!storageUrl) {
        logger.warn(`No upload URL for ${file} — skipping AudioTrack row for mood '${mood}'`);
        continue;
      }

      await client.query('INSERT INTO audio_track (title, mood, storage_url) VALUES ($1, $2, $3)', [
        title,
        mood,
        storageUrl,
      ]);
      inserted++;
    }

    logger.log(`Seeded ${inserted} AudioTrack rows into Data Connect`);
  } catch (error) {
    logger.error('Failed to seed Data Connect AudioTrack table', error);
  } finally {
    await client.end().catch(() => {});
  }
};

// ── Main emulation flow ─────────────────────────────────────────────────────

logger.log('Starting emulation...');

await deleteAllEmulatorUsers();

await createNpcs();

// Upload audio assets to Storage emulator, then seed Data Connect AudioTrack rows
const audioUrls = await uploadAudioAssets();
await seedAudioTracks(audioUrls);

for (const user of EMULATOR_USERS) {
  await createEmulatorUser(user.email, user.displayName, user.userRole);
}

logger.log('Emulation complete!');
