import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';

export const serverTimestamp = () => FieldValue.serverTimestamp();
export const serverIncrement = (n: number) => FieldValue.increment(n);
export const serverDelete = () => FieldValue.delete();
export const timestampFromDate = (date: Date) => Timestamp.fromDate(date);
export const documentId = () => FieldPath.documentId();
export const arrayUnion = (...elements: unknown[]) => FieldValue.arrayUnion(...elements);
export const arrayRemove = (...elements: unknown[]) => FieldValue.arrayRemove(...elements);
export const timestampNow = () => Timestamp.now();

export const getXDaysFromNowTimestamp = (days: number): Timestamp => {
  return timestampFromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
};
