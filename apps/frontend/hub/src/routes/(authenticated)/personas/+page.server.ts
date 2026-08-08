// apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts
//
// Server load function for the personas page.
// Loads personas from Data Connect (SQL `Persona` table) for SSR hydration.
// Uses static top-level imports — Bun's module resolution is fast and
// dynamic import() adds unnecessary Promise overhead on every request.
// Vite already chunks and optimizes server dependencies at build time.
//
// The client-side +page.ts casts the deserialized data to PersonaData. The
// mapper converts the SQL rows' RFC 3339 timestamps to Unix epoch ms so the
// SSR wire format matches the schema shapes directly.
import { dataConnect, listPersonas } from '@aikami/frontend/dataconnect';
import { error } from '@sveltejs/kit';
import { type PersonaRow, rowToData } from '$lib/client/services/dataconnect/persona_mapper.ts';
import { logger } from '$logger';
import type { PageServerLoad } from './$types';

/** Serialized form — timestamps are Unix epoch ms numbers, JSON-safe. */
export type PersonasPageServerData = {
  personas: Record<string, unknown>[];
};

export const load: PageServerLoad<PersonasPageServerData> = async (event) => {
  const { userSession } = event.locals;
  const uid = userSession?.id;

  // Unauthenticated requests keep their HTTP 401 — thrown outside the try so
  // the HttpError is not swallowed by the empty-list fallback below.
  if (!uid) {
    throw error(401, 'Unauthorized');
  }

  try {
    logger.debug('/personas:load fetching personas', { uid });

    // SERVER_ONLY fetch policy — explicit, so the SSR payload is always
    // freshly read (the SDK default PREFER_CACHE can serve stale rows).
    const result = await listPersonas(dataConnect, { uid }, { fetchPolicy: 'SERVER_ONLY' });
    const rows = result.data.personas ?? [];

    // Map rows to the flat PersonaData shape (RFC 3339 → epoch ms) so the
    // SSR wire format matches the client-side +page.ts cast contract.
    const personas = rows.map((row: PersonaRow) => rowToData(row));

    logger.debug('/personas:load success', { personaCount: personas.length });

    return { personas: personas as unknown as Record<string, unknown>[] };
  } catch (err) {
    // Rethrow SvelteKit HttpErrors (e.g. redirects) — only fall back to an
    // empty list for unexpected repository failures.
    if (err instanceof Error && 'status' in err) {
      throw err;
    }
    logger.error('/personas:load error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { personas: [] };
  }
};
