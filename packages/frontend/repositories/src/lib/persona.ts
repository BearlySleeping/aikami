import { PersonaSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getPersonaDocumentPath, getPersonasCollectionPath } from '@aikami/utils';
import {
  FrontendRepository,
  type FrontendRepositoryInterface,
} from './base-frontend-repository.ts';

export type PersonaRepositoryType = RepositoryType<
  typeof PersonaSchema,
  never,
  never,
  { uid: string },
  { uid: string; personaId: string }
>;

export type PersonaRepositoryInterface = FrontendRepositoryInterface<PersonaRepositoryType>;

export const personaRepository: PersonaRepositoryInterface =
  new FrontendRepository<PersonaRepositoryType>({
    className: 'PersonaRepository',
    createSchema: undefined,
    getCollectionPath: getPersonasCollectionPath,
    getDocumentPath: getPersonaDocumentPath,
    schema: PersonaSchema,
    updateSchema: undefined,
  });
