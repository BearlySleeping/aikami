import type { FieldValue } from './api/firestore.ts'

export type Nullable<T> = {
  [P in keyof T]?: T[P] | null
}

export type Removable<T> = {
  [P in keyof T]?: T[P] | FieldValue
}
