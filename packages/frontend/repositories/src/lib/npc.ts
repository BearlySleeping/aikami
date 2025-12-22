import { NpcSchema } from '@aikami/schemas';
import { getNpcDocumentPath, getNpcsCollectionPath } from '@aikami/utils';
import {
	FrontendRepository,
	type FrontendRepositoryInterface,
} from './base-frontend-repository.ts';
import type { RepositoryType } from '@aikami/types';

export type NpcRepositoryType = RepositoryType<
	typeof NpcSchema,
	never,
	never,
	undefined,
	{ npcId: string }
>;

export type NpcRepositoryInterface = FrontendRepositoryInterface<
	NpcRepositoryType
>;

export const npcRepository: NpcRepositoryInterface = new FrontendRepository<
	NpcRepositoryType
>({
	className: 'NpcRepository',
	createSchema: undefined,
	getCollectionPath: getNpcsCollectionPath,
	getDocumentPath: getNpcDocumentPath,
	schema: NpcSchema,
	updateSchema: undefined,
});
