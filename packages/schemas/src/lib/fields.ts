import type {
	FieldValue as BackendFieldValue,
	GeoPoint as BackendGeoPoint,
	Timestamp as BackendTimestamp,
} from "@google-cloud/firestore";
import type {
	FieldValue as FrontendFieldValue,
	GeoPoint as FrontendGeoPoint,
	Timestamp as FrontendTimestamp,
} from "firebase/firestore";
import { z } from "zod";

// Fields
type Timestamp = FrontendTimestamp | BackendTimestamp;
type FieldValue = FrontendFieldValue | BackendFieldValue;
type GeoPoint = FrontendGeoPoint | BackendGeoPoint;

const isTimestamp = (value: unknown): value is Timestamp =>
	typeof value === "object" &&
	value !== null &&
	"seconds" in value &&
	"nanoseconds" in value &&
	"toDate" in value &&
	"toMillis" in value;

export const TimestampSchema = z.custom<Timestamp>((timestamp) =>
	isTimestamp(timestamp),
);

const isFieldValue = (value: unknown): value is FieldValue => value !== null;

export const FieldValueSchema = z.custom<FieldValue>((value) =>
	isFieldValue(value),
);

const isGeoPoint = (value: unknown): value is GeoPoint => value !== null;

export const GeoPointSchema = z.custom<GeoPoint>((value) => isGeoPoint(value));

export const UniversalValueSchema = z.union([z.string(), z.number()]);
