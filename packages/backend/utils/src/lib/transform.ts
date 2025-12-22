import type { CoreData } from '@aikami/types'
import { Timestamp } from '@google-cloud/firestore'
import { unixLabel } from '@aikami/constants'

/**
 * Converts all `Timestamp` instances to `number` instances.
 *
 * @param data The data to convert.
 * @returns The converted data.
 */
export const toJsonData = (
  data: Omit<CoreData, 'createdAt'>,
): Record<string, unknown> => {
  const transformedData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      transformedData[key] = value.map(getValue)
      continue
    }

    if (value instanceof Timestamp) {
      transformedData[key + unixLabel] = value.toMillis()
      continue
    }

    if (typeof value === 'object' && value !== null) {
      transformedData[key] = toJsonData(value as unknown as CoreData)
      continue
    }

    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      value === undefined ||
      value === null ||
      typeof value === 'function'
    ) {
      continue
    }

    transformedData[key] = value
  }
  return transformedData
}

export const getValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((value) => {
      return getValue(value)
    })
  }

  if (typeof value === 'object' && value !== null) {
    return toJsonData(value as CoreData)
  }

  return value
}
