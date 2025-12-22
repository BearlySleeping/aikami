// frontend aka firebase
// backend aka firebase-admin
import type {
  CollectionReference as BackendCollectionReference,
  DocumentData as BackendDocumentData,
  DocumentReference as BackendDocumentReference,
  DocumentSnapshot as BackendDocumentSnapshot,
  FieldPath as BackendFieldPath,
  FieldValue as BackendFieldValue,
  Firestore as BackendFirestore,
  GeoPoint as BackendGeoPoint,
  Query as BackendQuery,
  QuerySnapshot as BackendQuerySnapshot,
  Timestamp as BackendTimestamp,
  UpdateData as BackendUpdateData,
  WhereFilterOp as BackendWhereFilterOp,
  WriteBatch as BackendWriteBatch,
} from '@google-cloud/firestore'
import type {
  DocumentData as FrontendDocumentData,
  DocumentReference as FrontendDocumentReference,
  DocumentSnapshot as FrontendDocumentSnapshot,
  FieldPath as FrontendFieldPath,
  FieldValue as FrontendFieldValue,
  Firestore as FrontendFirestore,
  GeoPoint as FrontendGeoPoint,
  Query as FrontendQuery,
  QuerySnapshot as FrontendQuerySnapshot,
  Timestamp as FrontendTimestamp,
  UpdateData as FrontendUpdateData,
  WhereFilterOp as FrontendWhereFilterOp,
  WriteBatch as FrontendWriteBatch,
} from 'firebase/firestore'

export type {
  BackendCollectionReference,
  BackendDocumentData,
  BackendDocumentReference,
  BackendDocumentSnapshot,
  BackendFieldPath,
  BackendFieldValue,
  BackendFirestore,
  BackendGeoPoint,
  BackendQuery,
  BackendQuerySnapshot,
  BackendTimestamp,
  BackendWhereFilterOp,
}

export type WriteBatch = FrontendWriteBatch | BackendWriteBatch

export type UpdateData<T extends DocumentData = DocumentData> =
  | BackendUpdateData<T>
  | FrontendUpdateData<T>

export type Firestore = FrontendFirestore | BackendFirestore

export type DocumentData = FrontendDocumentData | BackendDocumentData
export type WhereFilterOp = FrontendWhereFilterOp | BackendWhereFilterOp

export type FieldPath = FrontendFieldPath | BackendFieldPath
// Query
export type Query<T extends DocumentData = DocumentData> =
  | FrontendQuery<T>
  | BackendQuery<T>

export type QuerySnapshot<T extends DocumentData = DocumentData> =
  | FrontendQuerySnapshot<T>
  | BackendQuerySnapshot<T>

export type CollectionReference<T extends DocumentData = DocumentData> =
  | FrontendQuery<T>
  | BackendCollectionReference<T>

export type DocumentReference<T extends DocumentData = DocumentData> =
  | FrontendDocumentReference<T>
  | BackendDocumentReference<T>

export type DocumentSnapshot<T extends DocumentData = DocumentData> =
  | FrontendDocumentSnapshot<T>
  | BackendDocumentSnapshot<T>

// Fields
export type Timestamp = FrontendTimestamp | BackendTimestamp
export type FieldValue = FrontendFieldValue | BackendFieldValue
export type GeoPoint = FrontendGeoPoint | BackendGeoPoint

export type ServerTimestamp = () => FieldValue
export type ServerIncrement = (amount: number) => FieldValue
export type ServerArrayUnion = (...elements: unknown[]) => FieldValue
export type ServerArrayRemove = (...elements: unknown[]) => FieldValue

export type ServerDelete = () => FieldValue

export type ToGeoPoint = (lat: number, lng: number) => GeoPoint
export type ToTimestamp = (date: Date) => Timestamp

export type ToTimestampNow = () => Timestamp
