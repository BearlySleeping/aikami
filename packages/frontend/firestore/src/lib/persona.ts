import { PersonaCreateSchema, PersonaSchema, PersonaUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getPersonaDocumentPath, getPersonasCollectionPath } from '@aikami/utils';
import {
  FirestoreFrontendRepository,
  type FirestoreFrontendRepositoryInterface,
} from './base_firestore_frontend_repository.ts';

export type PersonaFirestoreRepositoryType = FirestoreRepositoryType<
  typeof PersonaSchema,
  typeof PersonaCreateSchema,
  typeof PersonaUpdateSchema,
  { uid: string },
  { uid: string; personaId: string }
>;

export type PersonaFirestoreRepositoryInterface =
  FirestoreFrontendRepositoryInterface<PersonaFirestoreRepositoryType>;

export const personaFirestoreRepository: PersonaFirestoreRepositoryInterface =
  new FirestoreFrontendRepository<PersonaFirestoreRepositoryType>({
    className: 'PersonaFirestoreRepository',
    createSchema: PersonaCreateSchema,
    getCollectionPath: getPersonasCollectionPath,
    getDocumentPath: getPersonaDocumentPath,
    schema: PersonaSchema,
    updateSchema: PersonaUpdateSchema,
  });
