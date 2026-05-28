import type { CoreCreateSchema, CoreSchema, CoreUpdateSchema } from '@aikami/schemas';
import type { ZodType, z } from 'zod';
import type { FieldPath, Timestamp, WhereFilterOp } from '../api/firestore.ts';
import type { Listener, Observable } from '../class.ts';
import type { CoreCreateData, CoreData, CoreUpdateData } from '../database/core.ts';

// ---
// helper method to get all keys of an object recursively
// see https://stackoverflow.com/questions/65332597/typescript-is-there-a-recursive-keyof
type RecursiveKeyOf<TObj extends object> = {
  [TKey in keyof TObj & (string | number)]: RecursiveKeyOfHandleValue<TObj[TKey], `${TKey}`>;
}[keyof TObj & (string | number)];

type RecursiveKeyOfInner<TObj extends object> = {
  [TKey in keyof TObj & (string | number)]: RecursiveKeyOfHandleValue<
    TObj[TKey],
    `['${TKey}']` | `.${TKey}`
  >;
}[keyof TObj & (string | number)];

type RecursiveKeyOfHandleValue<TValue, Text extends string> = TValue extends unknown[]
  ? Text
  : TValue extends object
    ? Text | `${Text}${RecursiveKeyOfInner<TValue>}`
    : Text;
// ---

export type SortField<T extends CoreData = CoreData> =
  | Extract<RecursiveKeyOf<T>, string>
  | FieldPath;

export type StartAfter = string | number | Timestamp;

export type QueryFilter<T extends CoreData = CoreData> = {
  /** If you use 'id' it will convert it to the firestore field 'documentId()' */
  field: Extract<RecursiveKeyOf<T>, string>;
  operator: WhereFilterOp;
  value: unknown;
};

export type OrderBy<T extends CoreData = CoreData> = {
  /** The field of the firestore document to sort by */
  field: SortField<T>;
  /**
   * 'asc' or 'desc'
   *
   * @default asc
   */
  order?: 'desc' | 'asc';
};

export type GetBaseQueryOptions<T extends CoreData> = {
  limit?: number;
  /**
   * If undefined it will use the createdAt in descending order.
   *
   * If null it will not sort the documents.
   */
  orderBy?: OrderBy<T> | null;
  startAfter?: StartAfter;
};

export type DocumentListener<T extends CoreData> = Listener<T>;

export type DocumentObservable<T extends CoreData> = Observable<T>;

export type DocumentsListener<T extends CoreData> = Listener<T[]>;

export type DocumentsObservable<T extends CoreData> = Observable<T[]>;

export type PostSortDocuments<T extends CoreData> = (documents: T[]) => T[];

export type GetBasePathArguments = Record<string, string | number> | undefined;

type GetCollectionQueryOptions<T extends CoreData, Argument extends GetBasePathArguments> = {
  getCollectionPathArgument: Argument;
  collectionGroupName?: never;
  filters?: QueryFilter<T>[];
} & GetBaseQueryOptions<T>;

export type GetCollectionNameQueryOptions<T extends CoreData> = {
  collectionGroupName: string;
  getCollectionPathArgument?: never;
  filters: QueryFilter<T>[];
} & GetBaseQueryOptions<T>;

export type GetQueryOptions<T extends CoreData, Argument extends GetBasePathArguments> =
  | GetCollectionQueryOptions<T, Argument>
  | GetCollectionNameQueryOptions<T>;

export type GetPathFunction<Argument extends GetBasePathArguments> = (argument: Argument) => string;

export type BatchCommand<
  CreateData extends CoreCreateData = CoreCreateData,
  UpdateData extends Partial<CoreUpdateData> = Partial<CoreUpdateData>,
  GetDocumentPathArgument extends GetBasePathArguments = GetBasePathArguments,
> = {
  documentPathArgument: GetDocumentPathArgument;
  type: 'update' | 'delete' | 'set';
  data: CreateData | UpdateData;
};

export type RepositoryType<
  Data extends ZodType<z.infer<typeof CoreSchema>> = ZodType<z.infer<typeof CoreSchema>>,
  CreateData extends ZodType<z.infer<typeof CoreCreateSchema>> = ZodType<
    z.infer<typeof CoreCreateSchema>
  >,
  UpdateData extends ZodType<z.infer<typeof CoreUpdateSchema>> = ZodType<
    z.infer<typeof CoreUpdateSchema>
  >,
  GetCollectionPathArgument extends GetBasePathArguments = GetBasePathArguments,
  GetDocumentPathArgument extends GetBasePathArguments = GetBasePathArguments,
> = {
  data: Data;
  createData: CreateData;
  updateData: UpdateData;
  getCollectionPathArgument: GetCollectionPathArgument;
  getDocumentPathArgument: GetDocumentPathArgument;
};
