import { PersonaCreateSchema, PersonaSchema, PersonaUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getPersonaDocumentPath, getPersonasCollectionPath } from '@aikami/utils';
import {
  FirestoreBackendRepository,
  type FirestoreBackendRepositoryInterface,
} from './base_firestore_backend_repository.ts';

export type PersonaFirestoreRepositoryType = FirestoreRepositoryType<
  typeof PersonaSchema,
  typeof PersonaCreateSchema,
  typeof PersonaUpdateSchema,
  { uid: string },
  { uid: string; personaId: string }
>;

export type PersonaFirestoreRepositoryInterface =
  FirestoreBackendRepositoryInterface<PersonaFirestoreRepositoryType>;

export const personaFirestoreRepository: PersonaFirestoreRepositoryInterface =
  new FirestoreBackendRepository<PersonaFirestoreRepositoryType>({
    className: 'PersonaFirestoreRepository',
    createSchema: PersonaCreateSchema,
    updateSchema: PersonaUpdateSchema,
    getCollectionPath: getPersonasCollectionPath,
    getDocumentPath: getPersonaDocumentPath,
    schema: PersonaSchema,
  });
