import type {
  FieldValue as BackendFieldValue,
  GeoPoint as BackendGeoPoint,
  Timestamp as BackendTimestamp,
} from '@google-cloud/firestore';
import type {
  FieldValue as FrontendFieldValue,
  GeoPoint as FrontendGeoPoint,
  Timestamp as FrontendTimestamp,
} from 'firebase/firestore';
import { z } from 'zod';

// Fields
type Timestamp = FrontendTimestamp | BackendTimestamp;
type FieldValue = FrontendFieldValue | BackendFieldValue;
type GeoPoint = FrontendGeoPoint | BackendGeoPoint;

const isTimestamp = (value: unknown): value is Timestamp =>
  typeof value === 'object' &&
  value !== null &&
  'seconds' in value &&
  'nanoseconds' in value &&
  'toDate' in value &&
  'toMillis' in value;

export const TimestampSchema = z.custom<Timestamp | Date>(
  (timestamp) => isTimestamp(timestamp) || timestamp instanceof Date,
);

// Check if value is a Firestore FieldValue (including sentinel values like serverTimestamp)
const isFieldValue = (value: unknown): value is FieldValue => {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  // Check for serverTimestamp sentinel: { _methodName: 'serverTimestamp' }
  const obj = value as Record<string, unknown>;
  if (obj._methodName === 'serverTimestamp') return true;
  // Check for other FieldValue sentinels (increment, delete, etc.)
  if (typeof obj._methodName === 'string') return true;
  // Check for regular Firestore FieldValue (has type and elements for arrays, etc.)
  if ('type' in obj || 'elements' in obj || 'fields' in obj) return true;
  return false;
};

export const FieldValueSchema = z.custom<FieldValue>((value) => isFieldValue(value));

const isGeoPoint = (value: unknown): value is GeoPoint => value !== null;

export const GeoPointSchema = z.custom<GeoPoint>((value) => isGeoPoint(value));

export const UniversalValueSchema = z.union([z.string(), z.number()]);
