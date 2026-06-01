// packages/frontend/repositories/src/lib/base_frontend_repository.ts
import { publicEnv } from '@aikami/frontend/configs/environment';
import type { Timestamp } from '@aikami/frontend/configs/firestore.ts';
import type {
  BatchCommand,
  DocumentListener,
  DocumentObservable,
  DocumentsListener,
  DocumentsObservable,
  FieldValue,
  GetQueryOptions,
  ParseLevel,
  PostSortDocuments,
  QueryFilter,
  RepositoryType,
  ServerArrayRemove,
  ServerArrayUnion,
  ServerDelete,
  ServerIncrement,
  ServerTimestamp,
} from '@aikami/types';
import {
  BaseRepository,
  type BaseRepositoryInterface,
  type BaseRepositoryOptions,
} from '@aikami/utils';
import type {
  CollectionReference,
  DocumentChange,
  DocumentReference,
  DocumentSnapshot,
  FirestoreError,
  Query,
  QueryConstraint,
  QuerySnapshot,
  Unsubscribe,
  WriteBatch,
} from 'firebase/firestore';
import type Type from 'typebox';

export type { QueryFilter, RepositoryType };

type CustomTimestamp = {
  _seconds: number;
  _nanoseconds: number;
};

type Database = typeof import('@aikami/frontend/configs/firestore.ts');

const isCustomTimestamp = (obj: unknown): obj is CustomTimestamp => {
  return (
    !!obj &&
    typeof obj === 'object' &&
    '_seconds' in obj &&
    '_nanoseconds' in obj &&
    typeof obj._seconds === 'number' &&
    typeof obj._nanoseconds === 'number'
  );
};

export type FrontendRepositoryInterface<T extends RepositoryType> = {
  getDocumentsStreamByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
    postSort?: PostSortDocuments<Type.Static<T['data']>>,
  ): Promise<DocumentsObservable<Type.Static<T['data']>>>;
  getDocumentStream(
    getDocumentPathArgument: T['getDocumentPathArgument'],
  ): Promise<DocumentObservable<Type.Static<T['data']>>>;

  getFieldOperators(): Promise<{
    arrayUnion: ServerArrayUnion;
    serverIncrement: ServerIncrement;
    serverTimestamp: ServerTimestamp;
    arrayRemove: ServerArrayRemove;
    serverDelete: ServerDelete;
    documentId: () => FieldValue;
    // biome-ignore lint/style/useNamingConvention: Firebase class and method names
    Timestamp: typeof Timestamp;
  }>;

  getRawCollectionReference(collectionPath: string): Promise<CollectionReference>;

  getRawDocumentReference(documentPath: string): Promise<DocumentReference>;

  getNewDocumentIdFunction(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<() => string>;

  getDocumentsStreamMultipleQuery(
    queries: Query<Type.Static<T['data']>>[],
    postSort?: PostSortDocuments<Type.Static<T['data']>>,
  ): Promise<DocumentsObservable<Type.Static<T['data']>>>;

  getRawQuery(query: {
    filters: QueryFilter<Type.Static<T['data']>>[];
    collectionPath: string;
  }): Promise<Query<Type.Static<T['data']>>>;

  getQueryCount(query: Query): Promise<number>;

  getDocumentsByGroupQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<Type.Static<T['data']>[]>;

  getDocumentsByRawQuery(query: Query): Promise<Type.Static<T['data']>[]>;

  getWriteBatch(): Promise<WriteBatch>;
} & BaseRepositoryInterface<T>;

export class FrontendRepository<T extends RepositoryType>
  extends BaseRepository<T>
  implements FrontendRepositoryInterface<T>
{
  private static _database?: Database;

  constructor(options: BaseRepositoryOptions<T>) {
    super({
      ...options,
      parseLevel: options.parseLevel ?? (publicEnv.PUBLIC_PARSE_LEVEL as ParseLevel | undefined),
    });
  }

  async getDocument(
    getDocumentPathArguments: T['getDocumentPathArgument'],
  ): Promise<Type.Static<T['data']> | undefined> {
    const [{ getDoc }, documentReference] = await Promise.all([
      this._getDatabase(),
      this.getDocumentReference<Type.Static<T['data']>>(getDocumentPathArguments),
    ]);

    const documentSnap = await getDoc(documentReference);
    if (!documentSnap.exists()) {
      return;
    }

    const data = this.toData(documentSnap);
    return this.parse('data', data);
  }

  async getDocumentsByCollection(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<Type.Static<T['data']>[]> {
    const [{ getDocs }, collectionReference] = await Promise.all([
      this._getDatabase(),
      this.getCollectionReference<Type.Static<T['data']>>(getCollectionPathArgument),
    ]);

    const querySnapshot = await getDocs(collectionReference);
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs);
  }
  async getNewDocumentId(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<string> {
    const [{ doc }, collectionReference] = await Promise.all([
      this._getDatabase(),
      this.getCollectionReference(getCollectionPathArgument),
    ]);

    const newDocumentId = doc(collectionReference).id;
    return newDocumentId;
  }
  async getNewDocumentIdFunction(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<() => string> {
    const [{ doc }, collectionReference] = await Promise.all([
      this._getDatabase(),
      this.getCollectionReference(getCollectionPathArgument),
    ]);

    return () => doc(collectionReference).id;
  }
  async getDocumentsByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<Type.Static<T['data']>[]> {
    const [{ getDocs }, currentQuery] = await Promise.all([
      this._getDatabase(),
      this.getQuery(query),
    ]);

    let querySnapshot: QuerySnapshot;
    try {
      querySnapshot = await getDocs(currentQuery);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return [];
      }
      throw error;
    }
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs);
  }
  async getDocumentsByRawQuery(query: Query): Promise<Type.Static<T['data']>[]> {
    const [{ getDocs }] = await Promise.all([this._getDatabase()]);

    let querySnapshot: QuerySnapshot;
    try {
      querySnapshot = await getDocs(query);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return [];
      }
      throw error;
    }
    if (querySnapshot.empty) {
      return [];
    }
    return this.parseDocuments(querySnapshot.docs);
  }
  async getDocumentsStreamByQuery(
    query: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
    postSort?: PostSortDocuments<Type.Static<T['data']>>,
  ): Promise<DocumentsObservable<Type.Static<T['data']>>> {
    const [{ onSnapshot }, currentQuery] = await Promise.all([
      this._getDatabase(),
      this.getQuery(query),
    ]);
    return (
      listener: DocumentsListener<Type.Static<T['data']>>,
      onError?: (error: FirestoreError) => void,
      onCompletion?: () => void,
      onDeleted?: (ids: string[]) => void,
    ) => {
      let completed = false;
      const unsubscribe = onSnapshot(
        currentQuery,
        async (querySnapshot: QuerySnapshot<Type.Static<T['data']>>) => {
          const documents = await this.parseDocuments(querySnapshot.docs);

          void listener(postSort ? postSort(documents) : documents);
          const deletedIds = querySnapshot
            .docChanges()
            .filter((change: DocumentChange<Type.Static<T['data']>>) => change.type === 'removed')
            .map((change: DocumentChange<Type.Static<T['data']>>) => change.doc.id);

          if (deletedIds.length > 0) {
            onDeleted?.(deletedIds);
          }

          if (completed) {
            return;
          }
          completed = true;
          onCompletion?.();
        },
        (error: FirestoreError) => {
          this.error('getDocumentsStreamByQuery', error);
          onError?.(error);
        },
        () => {
          if (completed) {
            return;
          }
          completed = true;
          onCompletion?.();
        },
      );

      return { unsubscribe };
    };
  }
  async getDocumentsByGroupQuery(
    options: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<Type.Static<T['data']>[]> {
    const [{ getDocs }, currentQuery] = await Promise.all([
      this._getDatabase(),
      this.getQuery(options),
    ]);

    const querySnapshot = await getDocs(currentQuery);
    if (querySnapshot.empty) {
      return [];
    }

    return this.parseDocuments(querySnapshot.docs);
  }
  async addDocument({
    createData,
    getCollectionPathArgument,
  }: {
    getCollectionPathArgument: T['getCollectionPathArgument'];
    createData: Omit<Type.Static<T['createData']>, 'createdAt'>;
  }): Promise<string> {
    const [{ addDoc, serverTimestamp }, collectionReference] = await Promise.all([
      this._getDatabase(),
      this.getCollectionReference(getCollectionPathArgument),
    ]);

    const data = await this.parse('createData', {
      createdAt: serverTimestamp(),
      ...createData,
    });

    const response = await addDoc(collectionReference, data);

    return response.id;
  }

  async commit(batchCommands: BatchCommand[]): Promise<void> {
    const batch = await this.getWriteBatch();

    const addToBatchCommand = async ({ data, documentPathArgument, type }: BatchCommand) => {
      const documentReference = await this.getDocumentReference(documentPathArgument);
      switch (type) {
        case 'set':
          batch.set(documentReference, data as Type.Static<T['createData']>);
          break;
        case 'update':
          batch.update(documentReference, data);
          break;
        case 'delete':
          batch.delete(documentReference);
          break;
      }
    };

    await Promise.all(batchCommands.map(addToBatchCommand));

    await batch.commit();
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
    const [{ serverTimestamp, setDoc }, documentReference] = await Promise.all([
      this._getDatabase(),
      this.getDocumentReference(getDocumentPathArgument),
    ]);

    const data = await this.parse('createData', {
      createdAt: serverTimestamp(),
      ...setData,
    });

    await setDoc(documentReference, data, {
      merge: options?.merge,
    });
  }

  async deleteDocument(getDocumentPathArgument: T['getDocumentPathArgument']): Promise<void> {
    const [{ deleteDoc }, documentReference] = await Promise.all([
      this._getDatabase(),
      this.getDocumentReference(getDocumentPathArgument),
    ]);
    await deleteDoc(documentReference);
  }

  async deleteDocuments(getDocumentPathArguments: T['getDocumentPathArgument'][]): Promise<void> {
    const { firestore, writeBatch } = await this._getDatabase();
    const batch = writeBatch(firestore);

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

  async getDocumentsStreamMultipleQuery(
    queries: Query<Type.Static<T['data']>>[],
    postSort?: PostSortDocuments<Type.Static<T['data']>>,
  ): Promise<DocumentsObservable<Type.Static<T['data']>>> {
    const documents: Type.Static<T['data']>[] = [];
    const unsubscribes: Unsubscribe[] = [];
    const { onSnapshot } = await this._getDatabase();
    let completionCount = 0;
    return (
      listener: DocumentsListener<Type.Static<T['data']>>,
      onError?: (error: FirestoreError) => void,
      onCompletion?: () => void,
    ) => {
      for (const query of queries) {
        unsubscribes.push(
          onSnapshot(
            query,
            async (querySnapshot: QuerySnapshot<Type.Static<T['data']>>) => {
              const newDocuments = await this.parseDocuments(querySnapshot.docs);
              this.log('----newDocuments', newDocuments);

              for (const newDocument of newDocuments) {
                const index = documents.findIndex((d) => d.id === newDocument.id);
                if (index === -1) {
                  documents.push(newDocument);
                } else {
                  documents[index] = newDocument;
                }
              }
              void listener(postSort ? postSort(documents) : documents);
            },
            (error: FirestoreError) => {
              this.error('getDocumentsStreamMultipleQuery', error);
              onError?.(error);
            },
            () => {
              completionCount++;
              if (completionCount === queries.length) {
                onCompletion?.();
              }
            },
          ),
        );
      }

      return {
        unsubscribe: () => {
          for (const u of unsubscribes) {
            u();
          }
        },
      };
    };
  }

  async getRawQuery(options: {
    filters: QueryFilter<Type.Static<T['data']>>[];
    collectionPath: string;
  }): Promise<Query<Type.Static<T['data']>>> {
    const { collection, documentId, firestore, query, where } = await this._getDatabase();
    const { collectionPath, filters } = options;
    const constraints: QueryConstraint[] = [];
    for (const { field, operator, value } of filters) {
      constraints.push(where(field === 'id' ? documentId() : field, operator, value));
    }

    this.debug('getQuery', constraints);

    return query<Type.Static<T['data']>, Type.Static<T['data']>>(
      // @ts-expect-error TODO: Remove this when firebase don't require index signature
      collection(firestore, collectionPath),
      ...constraints,
    );
  }
  async getDocumentStream(
    getDocumentPathArgument: T['getDocumentPathArgument'],
  ): Promise<DocumentObservable<Type.Static<T['data']>>> {
    const { onSnapshot } = await this._getDatabase();
    const documentReference =
      await this.getDocumentReference<Type.Static<T['data']>>(getDocumentPathArgument);

    return (
      listener: DocumentListener<Type.Static<T['data']>>,
      onError?: (error: FirestoreError) => void,
      onCompletion?: () => void,
    ) => {
      const unsubscribe = onSnapshot(
        documentReference,
        async (documentSnapshot: DocumentSnapshot<Type.Static<T['data']>>) => {
          void listener(
            documentSnapshot.exists()
              ? await this.parse('data', this.toData(documentSnapshot))
              : undefined,
          );
        },
        (error: FirestoreError) => {
          this.error('getDocumentStream', error);
          onError?.(error);
        },
        onCompletion,
      );
      return { unsubscribe };
    };
  }

  async getDocumentReference<
    Document extends
      | Type.Static<T['data']>
      | Type.Static<T['createData']>
      | Partial<Type.Static<T['updateData']>>,
  >(documentArgument: T['getDocumentPathArgument']): Promise<DocumentReference<Document>> {
    const { doc, firestore } = await this._getDatabase();

    return doc(firestore, this.getDocumentPath(documentArgument)) as DocumentReference<Document>;
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
    const [{ serverTimestamp, setDoc, updateDoc }, documentReference] = await Promise.all([
      this._getDatabase(),
      this.getDocumentReference<Partial<Type.Static<T['updateData']>>>(getDocumentPathArgument),
    ]);

    const data = await this.parse('updateData', {
      updatedAt: serverTimestamp(),
      ...updateData,
    });

    if (options?.merge) {
      await setDoc(documentReference, data, {
        merge: true,
      });
    } else {
      await updateDoc(documentReference, data);
    }
  }
  async getWriteBatch(): Promise<WriteBatch> {
    const { firestore, writeBatch } = await this._getDatabase();

    return writeBatch(firestore);
  }
  async getRawCollectionReference(collectionPath: string): Promise<CollectionReference> {
    const { collection, firestore } = await this._getDatabase();

    return collection(firestore, collectionPath);
  }
  async getRawDocumentReference(documentPath: string): Promise<DocumentReference> {
    const { doc, firestore } = await this._getDatabase();

    return doc(firestore, documentPath);
  }
  async getFieldOperators() {
    const {
      arrayRemove,
      arrayUnion,
      deleteField,
      documentId,
      increment,
      serverTimestamp,
      Timestamp: FbTimestamp,
    } = await this._getDatabase();
    return {
      arrayRemove,
      arrayUnion,
      documentId,
      serverDelete: deleteField,
      serverIncrement: increment,
      serverTimestamp,
      Timestamp: FbTimestamp,
    };
  }
  async getQueryCount(query: Query): Promise<number> {
    const { getCountFromServer } = await this._getDatabase();
    const querySnapshot = await getCountFromServer(query);
    return querySnapshot.data().count;
  }
  async getCollectionReference<
    Document extends Type.Static<T['data']> | Type.Static<T['createData']>,
  >(
    getCollectionPathArgument: T['getCollectionPathArgument'],
  ): Promise<CollectionReference<Document>> {
    const { collection, firestore } = await this._getDatabase();

    return collection(
      firestore,
      this.getCollectionPath(getCollectionPathArgument),
    ) as CollectionReference<Document>;
  }
  async getCollectionGroupReference<
    Document extends Type.Static<T['data']> | Type.Static<T['createData']>,
  >(collectionGroupName: string): Promise<Query<Document>> {
    const { collectionGroup, firestore } = await this._getDatabase();

    return collectionGroup(firestore, collectionGroupName) as Query<Document>;
  }

  async getQuery(
    options: GetQueryOptions<Type.Static<T['data']>, T['getCollectionPathArgument']>,
  ): Promise<Query<Type.Static<T['data']>>> {
    const { documentId, limit, orderBy, query, startAfter, Timestamp, where } =
      await this._getDatabase();

    const { filters, limit: limitTo, orderBy: orderByParameter } = options;
    let startAfterParameter = options.startAfter;
    this.debug('getQuery:baseQueryOptions', options);

    const constraints: QueryConstraint[] = [];
    if (filters) {
      for (const { field, operator, value } of filters) {
        constraints.push(where(field === 'id' ? documentId() : field, operator, value));
      }
    }

    if (orderByParameter !== null) {
      constraints.push(
        orderByParameter
          ? orderBy(orderByParameter.field, orderByParameter.order)
          : orderBy('createdAt', 'desc'),
      );
    }
    if (startAfterParameter) {
      if (isCustomTimestamp(startAfterParameter)) {
        const millis =
          startAfterParameter._seconds * 1000 + startAfterParameter._nanoseconds / 1000000;
        startAfterParameter = Timestamp.fromMillis(millis);
      }

      constraints.push(startAfter(startAfterParameter));
    }

    if (limitTo) {
      constraints.push(limit(limitTo));
    }

    return query<Type.Static<T['data']>, Type.Static<T['data']>>(
      // @ts-expect-error TODO: Remove this when firebase don't require index signature
      options.collectionGroupName
        ? await this.getCollectionGroupReference(options.collectionGroupName)
        : await this.getCollectionReference(options.getCollectionPathArgument),
      ...constraints,
    );
  }

  private async _getDatabase(): Promise<Database> {
    if (FrontendRepository._database) {
      return FrontendRepository._database;
    }

    if (import.meta.env.SSR || typeof window === 'undefined' || import.meta.env.STORYBOOK) {
      throw new Error(`${this._className} is not available on SSR`);
    }

    FrontendRepository._database = await import('@aikami/frontend/configs/firestore');
    return FrontendRepository._database;
  }
}
