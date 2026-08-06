import type { PersonaData } from '@aikami/schemas';

/** Client-side page data after fromJsonData deserialization. */
export type PersonasPageData = {
  personas: PersonaData[];
};
