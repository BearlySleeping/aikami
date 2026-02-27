import { PersonaCreateSchema, PersonaSchema, PersonaUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getPersonaDocumentPath, getPersonasCollectionPath } from '@aikami/utils';
import { BackendRepository, type BackendRepositoryInterface } from './base-backend-repository.ts';

export type PersonaRepositoryType = RepositoryType<
  typeof PersonaSchema,
  typeof PersonaCreateSchema,
  typeof PersonaUpdateSchema,
  { uid: string },
  { uid: string; personaId: string }
>;

export type PersonaRepositoryInterface = BackendRepositoryInterface<PersonaRepositoryType>;

export const personaRepository: PersonaRepositoryInterface =
  new BackendRepository<PersonaRepositoryType>({
    className: 'PersonaRepository',
    createSchema: PersonaCreateSchema,
    updateSchema: PersonaUpdateSchema,
    getCollectionPath: getPersonasCollectionPath,
    getDocumentPath: getPersonaDocumentPath,
    schema: PersonaSchema,
  });
