// apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts
//
// Server load function for the personas page.
// Loads personas from the database for SSR hydration.
// Uses static top-level imports — Bun's module resolution is fast and
// dynamic import() adds unnecessary Promise overhead on every request.
// Vite already chunks and optimizes server dependencies at build time.
//
// The client-side +page.ts casts the deserialized data to ChatData/MessageData.

import { personaRepository } from '@aikami/backend/database/persona';
import { toJsonData } from '@aikami/backend/utils/transform';
import { error } from '@sveltejs/kit';
import { logger } from '$logger';
import type { PageServerLoad } from './$types';

/** Serialized form — timestamps are Unix epoch ms numbers, JSON-safe. */
export type PersonasPageServerData = {
  personas: Record<string, unknown>[];
};

export const load: PageServerLoad<PersonasPageServerData> = async (event) => {
  const { userSession } = event.locals;
  const uid = userSession?.id;

  logger.debug('/personas:load fetching personas', { uid });

  if (!uid) {
    throw error(401, 'Unauthorized');
  }

  try {
    const personas = await personaRepository.getDocumentsByQuery({
      filters: [
        {
          field: 'uid',
          operator: '==',
          value: uid,
        },
      ],
      getCollectionPathArgument: { uid },
      limit: 10,
    });

    if (!personas) {
      logger.debug('/personas:load personas not found', { uid });
      return { personas: [] };
    }

    // toJsonData converts any nested Timestamp instances → numbers for safe
    // SSR serialization. Chat/Message schemas use z.number() for timestamps,
    // but nested fields like participants[uid].joinedAt may be Firestore Timestamps.
    const serializedPersonas = personas.map((persona) =>
      toJsonData(persona as unknown as Parameters<typeof toJsonData>[0]),
    );

    logger.debug('/personas:load success', {
      personaCount: serializedPersonas.length,
    });

    return { personas: serializedPersonas };
  } catch (err) {
    logger.error('/personas:load error', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Re-throw HttpError instances to preserve their status codes
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return { personas: [] };
  }
};
