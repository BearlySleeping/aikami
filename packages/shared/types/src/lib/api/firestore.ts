// packages/shared/types/src/lib/api/firestore.ts
//
// ⚠️ Firestore has been removed from the product (C-386). This file keeps the
// legacy type surface that downstream shared packages still reference
// (FieldValue, Timestamp, GeoPoint, repository option shapes) as plain
// structural types with NO firebase SDK import. No new code should depend on
// these; they exist solely so the shared types package compiles for the
// remaining consumers (oauth2 form helpers, Removable/Nullable, domain utils).

// ── Generic document/value shapes (firestore-shaped, SDK-free) ─────────

/** A Firestore-shaped document (any JSON-ish record). */
export type DocumentData = Record<string, unknown>;

/** Sentinel values such as serverTimestamp/delete (structural stand-in). */
export type FieldValue = unknown;

/** A timestamp value (Date, number, or { seconds, nanoseconds }). */
export type Timestamp =
  | Date
  | number
  | { seconds: number; nanoseconds?: number; toDate: () => Date };

/** A geospatial point. */
export type GeoPoint = { latitude: number; longitude: number };

/** Field path operator set (legacy surface). */
export type WhereFilterOp = string;

/** Field path reference (legacy surface). */
export type FieldPath = string;

// ── Repository-shaped types (legacy surface, SDK-free) ─────────────────

export type WriteBatch = unknown;
export type Firestore = unknown;
export type Query = unknown;
export type QuerySnapshot = unknown;
export type CollectionReference = unknown;
export type DocumentReference = unknown;
export type DocumentSnapshot = unknown;
export type UpdateData = unknown;

/** Creates a Firestore FieldValue serverTimestamp sentinel. */
export type ServerTimestamp = () => FieldValue;
/** Creates a Firestore FieldValue increment sentinel. */
export type ServerIncrement = (amount: number) => FieldValue;
/** Creates a Firestore FieldValue arrayUnion sentinel. */
export type ServerArrayUnion = (...elements: unknown[]) => FieldValue;
/** Creates a Firestore FieldValue arrayRemove sentinel. */
export type ServerArrayRemove = (...elements: unknown[]) => FieldValue;
/** Creates a Firestore FieldValue delete sentinel. */
export type ServerDelete = () => FieldValue;

/** Converts lat/lng to a GeoPoint. */
export type ToGeoPoint = (lat: number, lng: number) => GeoPoint;
/** Converts a Date to a Timestamp. */
export type ToTimestamp = (date: Date) => Timestamp;
/** Returns the current time as a Timestamp. */
export type ToTimestampNow = () => Timestamp;
