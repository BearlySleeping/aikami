// packages/backend/database/src/lib/base_backend_repository.ts
import { getFirestore } from '@aikami/backend/configs/database';
import { backendEnv } from '@aikami/backend/configs/environment';
import { documentId, serverTimestamp } from '@aikami/backend/configs/firestore';
import { getBatch } from '@aikami/backend/utils/batch';
import type { GetQueryOptions, QueryFilter, RepositoryType } from '@aikami/types';
import {
  BaseRepository,
  type BaseRepositoryInterface,
  type BaseRepositoryOptions,
} from '@aikami/utils';
import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  PartialWithFieldValue,
  Query,
} from '@google-cloud/firestore';
import type Type from 'typebox';

export type BackendRepositoryInterface<T extends RepositoryType> = BaseRepositoryInterface<T> & {
  deleteDocumentsByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
    shouldDelete?: (document: Type.Static<T['data']>) => Promise<boolean> | boolean,
  ): Promise<void>;

  updateDocumentsByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
    update: (
      document: Type.Static<T['data']>,
    ) =>
      | Promise<Partial<Type.Static<T['updateData']>> | undefined>
      | Partial<Type.Static<T['updateData']>>
      | undefined,
    options?: { merge?: boolean },
  ): Promise<void>;

  updateDocuments(
    documents: DocumentSnapshot[],
    update: (
      document: Type.Static<T['data']>,
    ) =>
      | Promise<Partial<Type.Static<T['updateData']>> | undefined>
      | Partial<Type.Static<T['updateData']>>
      | undefined,
    options?: { merge?: boolean },
  ): Promise<void>;

  getDocumentsBaseOnIds(
    getCollectionPathArgument: T['getCollectionPathArgument'],
    ids: string[],
  ): Promise<DocumentSnapshot[]>;

  getFilters(
    ...filters: QueryFilter<Type.Static<T['data']>>[]
  ): QueryFilter<Type.Static<T['data']>>[];
};

export class BackendRepository<T extends RepositoryType>
  extends BaseRepository<T>
  implements BackendRepositoryInterface<T>
{
  private static _database?: Firestore;

  constructor(options: BaseRepositoryOptions<T>) {
    super({
      ...options,
      parseLevel: options.parseLevel ?? backendEnv.PARSE_LEVEL,
    });
  }

  async getDocument(
    getDocumentPathArguments: T['getDocumentPathArgument'],
  ): Promise<Type.Static<T['data']> | undefined> {
    const documentReference =
      await this.getDocumentReference<Type.Static<T['data']>>(getDocumentPathArguments);
    const documentSnap = await documentReference.get();
    if (!documentSnap.exists) {
      return;
    }

    const data = this.toData(documentSnap);
    return this.parse('data', data);
  }

  async getDocumentsByCollection(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<Type.Static<T['data']>[]> {
    const collectionReference =
      await this.getCollectionReference<Type.Static<T['data']>>(getCollectionPathArgument);

    const querySnapshot = await collectionReference.get();
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs.filter((doc) => doc.exists));
  }

  async getNewDocumentId(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<string> {
    const newDocumentId = (await this.getCollectionReference(getCollectionPathArgument)).doc().id;
    return newDocumentId;
  }

  async getDocumentsByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<Type.Static<T['data']>[]> {
    const queryReference = await this._getQuery(query);
    const querySnapshot = await queryReference.get();
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs.filter((doc) => doc.exists));
  }

  async addDocument({
    createData,
    getCollectionPathArgument,
  }: {
    getCollectionPathArgument: T['getCollectionPathArgument'];
    createData: Omit<Type.Static<T['createData']>, 'createdAt'>;
  }): Promise<string> {
    const collectionReference =
      await this.getCollectionReference<Type.Static<T['createData']>>(getCollectionPathArgument);

    const data = await this.parse('createData', {
      createdAt: serverTimestamp(),
      ...createData,
    });
    const response = await collectionReference.add(data);

    return response.id;
  }

  async setDocument({
    getDocumentPathArgument,
    options,
    setData,
  }: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    setData: Omit<Type.Static<T['createData']>, 'createdAt'>;
    options?: {
      merge?: boolean;
    };
  }): Promise<void> {
    const documentReference = await this.getDocumentReference(getDocumentPathArgument);
    const data = await this.parse('createData', {
      createdAt: serverTimestamp(),
      ...setData,
    });

    await documentReference.set(data, {
      merge: options?.merge,
    });
  }

  async deleteDocument(getDocumentPathArgument: T['getDocumentPathArgument']): Promise<void> {
    const documentReference = await this.getDocumentReference(getDocumentPathArgument);

    await documentReference.delete();
  }

  async deleteDocuments(getDocumentPathArguments: T['getDocumentPathArgument'][]): Promise<void> {
    const database = await this._getDatabase();
    const batch = database.batch();

    const documentReferences = await Promise.all(
      getDocumentPathArguments.map((getDocumentPathArgument) =>
        this.getDocumentReference(getDocumentPathArgument),
      ),
    );

    for (const documentReference of documentReferences) {
      batch.delete(documentReference);
    }

    await batch.commit();
  }

  async deleteDocumentsByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
    shouldDelete?: (document: Type.Static<T['data']>) => Promise<boolean> | boolean,
  ): Promise<void> {
    const queryReference = await this._getQuery(query);
    const querySnapshot = await queryReference.get();
    if (querySnapshot.empty) {
      return;
    }

    const documents = querySnapshot.docs.filter((doc) => doc.exists);
    const database = await this._getDatabase();

    const batchArray = [database.batch()];
    let operationCounter = 0;
    let batchIndex = 0;

    const handleQuery = async (document: DocumentSnapshot) => {
      if (shouldDelete && !(await shouldDelete(this.toData(document)))) {
        return;
      }
      batchArray[batchIndex]?.delete(document.ref);
      operationCounter++;

      if (operationCounter > 498) {
        batchArray.push(database.batch());
        batchIndex++;
        operationCounter = 0;
      }
    };

    const baseBatch = getBatch();

    for (const document of documents) {
      baseBatch.push(() => handleQuery(document));
    }

    await baseBatch.commit();
    await Promise.all(batchArray.map((batch) => batch.commit()));
  }

  async getDocumentReference<
    Document extends
      | Type.Static<T['data']>
      | Type.Static<T['createData']>
      | Partial<Type.Static<T['updateData']>>,
  >(documentArgument: T['getDocumentPathArgument']): Promise<DocumentReference<Document>> {
    const database = await this._getDatabase();

    return database.doc(this.getDocumentPath(documentArgument)) as DocumentReference<Document>;
  }

  async updateDocument({
    getDocumentPathArgument,
    options,
    updateData,
  }: {
    getDocumentPathArgument: T['getDocumentPathArgument'];
    updateData: Omit<Partial<Type.Static<T['updateData']>>, 'updatedAt'>;
    options?: {
      merge?: boolean;
    };
  }): Promise<void> {
    const documentReference =
      await this.getDocumentReference<Type.Static<T['data']>>(getDocumentPathArgument);

    const data = await this.parse('updateData', {
      updatedAt: serverTimestamp(),
      ...updateData,
    });

    if (options?.merge) {
      await documentReference.set(data as PartialWithFieldValue<Type.Static<T['data']>>, {
        merge: true,
      });
    } else {
      await documentReference.update(data);
    }
  }

  async getCollectionReference<
    Document extends Type.Static<T['data']> | Type.Static<T['createData']>,
  >(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<CollectionReference<Document>> {
    const database = await this._getDatabase();

    return database.collection(
      this.getCollectionPath(getCollectionPathArgument),
    ) as CollectionReference<Document>;
  }
  async updateDocumentsByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
    update: (
      document: Type.Static<T['data']>,
    ) =>
      | Promise<Partial<Type.Static<T['updateData']>> | undefined>
      | Partial<Type.Static<T['updateData']>>
      | undefined,
    options?: { merge?: boolean },
  ): Promise<void> {
    const queryReference = await this._getQuery(query);
    const querySnapshot = await queryReference.get();
    if (querySnapshot.empty) {
      return;
    }
    await this.updateDocuments(
      querySnapshot.docs.filter((doc) => doc.exists),
      update,
      options,
    );
  }

  async updateDocuments(
    documents: DocumentSnapshot[],
    update: (
      document: Type.Static<T['data']>,
    ) =>
      | Promise<Partial<Type.Static<T['updateData']>> | undefined>
      | Partial<Type.Static<T['updateData']>>
      | undefined,
    options?: { merge?: boolean },
  ) {
    const database = await this._getDatabase();

    const batchArray = [database.batch()];
    let operationCounter = 0;
    let batchIndex = 0;

    const handleDocument = async (document: DocumentSnapshot) => {
      const updateData = await update(this.toData(document));
      if (!updateData) {
        return;
      }

      const batch = batchArray[batchIndex];
      if (!batch) {
        throw new Error(`Batch is undefined at index ${batchIndex}`);
      }

      if (options?.merge) {
        batch.set(document.ref, updateData as Partial<unknown>, {
          merge: true,
        });
      } else {
        batch.update(document.ref, updateData as Partial<unknown>);
      }

      operationCounter++;

      if (operationCounter > 498) {
        batchArray.push(database.batch());
        batchIndex++;
        operationCounter = 0;
      }
    };

    const baseBatch = getBatch();

    for (const document of documents) {
      baseBatch.push(() => handleDocument(document));
    }

    await baseBatch.commit();

    await Promise.all(batchArray.map((batch) => batch.commit()));
  }

  async getDocumentsBaseOnIds(
    getCollectionPathArgument: T['getCollectionPathArgument'],
    ids: string[],
  ): Promise<DocumentSnapshot[]> {
    const collectionReference = await this.getCollectionReference(getCollectionPathArgument);
    if (ids.length <= 10) {
      const snapshot = await collectionReference.where(documentId(), 'in', ids).get();
      return snapshot.docs.filter((doc) => doc.exists);
    }

    const allDocs: DocumentSnapshot[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const end = i + 10;
      const chunk = ids.slice(i, end);
      const snapshot = await collectionReference.where(documentId(), 'in', chunk).get();
      allDocs.push(...snapshot.docs.filter((doc) => doc.exists));
    }
    return allDocs;
  }

  getFilters(
    ...filters: QueryFilter<Type.Static<T['data']>>[]
  ): QueryFilter<Type.Static<T['data']>>[] {
    return filters;
  }

  private async _getQuery(
    options: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<Query<Type.Static<T['data']>>> {
    const {
      collectionGroupName,
      filters,
      getCollectionPathArgument,
      limit: limitTo,
      orderBy: orderByParameter,
      startAfter: startAfterParameter,
    } = options;

    const database = await this._getDatabase();
    let query = (collectionGroupName
      ? database.collectionGroup(collectionGroupName)
      : database.collection(this.getCollectionPath(getCollectionPathArgument))) as unknown as Query<
      Type.Static<T['data']>
    >;

    if (filters) {
      for (const { field, operator, value } of filters) {
        query = query.where(field === 'id' ? documentId() : field, operator, value);
      }
    }

    if (orderByParameter) {
      query = query.orderBy(orderByParameter.field, orderByParameter.order);
    }
    if (startAfterParameter) {
      query = query.startAfter(startAfterParameter);
    }

    if (limitTo) {
      query = query.limit(limitTo);
    }

    return query;
  }

  private async _getDatabase(): Promise<Firestore> {
    if (BackendRepository._database) {
      return BackendRepository._database;
    }
    await Promise.resolve();
    BackendRepository._database = getFirestore();
    // biome-ignore lint/style/noNonNullAssertion: just assigned above
    return BackendRepository._database!;
  }
}
