// apps/frontend/hub/src/routes/(authenticated)/personas/+page.ts
//
// Client load function for the personas page.
// Server data from +page.server.ts has already been through toJsonData
// (converts any Timestamp instances → numbers). Since Persona schema
// use z.number() for timestamps (Unix epoch ms), no deserialization needed —
// the data arrives as plain JSON-compatible objects matching the schema shapes.

import type { PersonaData } from '@aikami/schemas';
import type { PersonasPageData } from '$types';
import type { PageLoad } from './$types';

export const load: PageLoad<PersonasPageData> = (event) => {
  const serializedPersonas = event.data.personas;
  // Server data is already JSON-safe (toJsonData converted any nested
  // Timestamp objects to numbers). Chat/Message schemas use z.number()
  // for timestamps, so the wire format matches the schema shapes directly.
  return {
    personas: serializedPersonas as PersonaData[],
  };
};
