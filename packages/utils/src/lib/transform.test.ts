// packages/utils/src/lib/transform.test.ts
import { assertEquals } from '@std/assert'
import { Timestamp } from 'firebase/firestore'
import { fromJsonData } from './transform.ts'
import { unixLabel } from '@aikami/constants'
import type { CoreData } from '@aikami/types'

// Mock CoreData for testing purposes
interface TestData extends Omit<CoreData, 'createdAt'> {
  id: string
  name: string
  value: number
  updatedAt?: Timestamp
  complex?: {
    nestedValue: string
    nestedDate?: Timestamp
  }
  items?: { name: string; date?: Timestamp }[]
}

Deno.test(
  'fromJsonData should convert Unix timestamps to Firestore Timestamps',
  () => {
    const now = Date.now()
    const rawData = {
      id: 'test1',
      name: 'Test Object',
      value: 123,
      [`updatedAt${unixLabel}`]: now,
      complex: {
        nestedValue: 'hello',
        [`nestedDate${unixLabel}`]: now - 10000,
      },
      items: [
        { name: 'item1', [`date${unixLabel}`]: now - 20000 },
        { name: 'item2' },
      ],
    }

    const expected: TestData = {
      id: 'test1',
      name: 'Test Object',
      value: 123,
      updatedAt: Timestamp.fromMillis(now),
      complex: {
        nestedValue: 'hello',
        nestedDate: Timestamp.fromMillis(now - 10000),
      },
      items: [
        { name: 'item1', date: Timestamp.fromMillis(now - 20000) },
        { name: 'item2' },
      ],
    }

    const result = fromJsonData<TestData>(rawData)
    assertEquals(result.id, expected.id)
    assertEquals(result.name, expected.name)
    assertEquals(result.value, expected.value)
    assertEquals(result.updatedAt?.isEqual(expected.updatedAt!), true)
    assertEquals(result.complex?.nestedValue, expected.complex?.nestedValue)
    assertEquals(
      result.complex?.nestedDate?.isEqual(expected.complex!.nestedDate!),
      true,
    )
    assertEquals(result.items?.length, expected.items?.length)
    assertEquals(result.items?.[0]?.name, expected.items?.[0]?.name)
    assertEquals(
      result.items?.[0]?.date?.isEqual(expected.items![0].date!),
      true,
    )
    assertEquals(result.items?.[1]?.name, expected.items?.[1]?.name)
    assertEquals(result.items?.[1]?.date, undefined)
  },
)

Deno.test('fromJsonData should handle data without timestamps', () => {
  const rawData = {
    id: 'test2',
    name: 'No Timestamps',
    value: 456,
  }

  const expected: TestData = {
    id: 'test2',
    name: 'No Timestamps',
    value: 456,
  }

  const result = fromJsonData<TestData>(rawData)
  assertEquals(result, expected)
})

Deno.test(
  'fromJsonData should handle nested objects without timestamps',
  () => {
    const rawData = {
      id: 'test3',
      name: 'Nested No Timestamps',
      value: 789,
      complex: {
        nestedValue: 'world',
      },
    }

    const expected: TestData = {
      id: 'test3',
      name: 'Nested No Timestamps',
      value: 789,
      complex: {
        nestedValue: 'world',
      },
    }

    const result = fromJsonData<TestData>(rawData)
    assertEquals(result, expected)
  },
)

Deno.test(
  'fromJsonData should handle arrays of objects with and without timestamps',
  () => {
    const now = Date.now()
    const rawData = {
      id: 'test4',
      name: 'Array Test',
      value: 101,
      items: [
        { name: 'itemA', [`date${unixLabel}`]: now },
        { name: 'itemB' },
        { name: 'itemC', [`date${unixLabel}`]: now - 5000 },
      ],
    }

    const expected: TestData = {
      id: 'test4',
      name: 'Array Test',
      value: 101,
      items: [
        { name: 'itemA', date: Timestamp.fromMillis(now) },
        { name: 'itemB' },
        { name: 'itemC', date: Timestamp.fromMillis(now - 5000) },
      ],
    }

    const result = fromJsonData<TestData>(rawData)
    assertEquals(result.items?.length, expected.items?.length)
    assertEquals(result.items?.[0].name, expected.items?.[0].name)
    assertEquals(
      result.items?.[0].date?.isEqual(expected.items![0].date!),
      true,
    )
    assertEquals(result.items?.[1].name, expected.items?.[1].name)
    assertEquals(result.items?.[1].date, undefined)
    assertEquals(result.items?.[2].name, expected.items?.[2].name)
    assertEquals(
      result.items?.[2].date?.isEqual(expected.items![2].date!),
      true,
    )
  },
)

Deno.test('fromJsonData should return an empty object for empty input', () => {
  const rawData = {}
  const expected = {}
  const result = fromJsonData<TestData>(rawData)
  assertEquals(result, expected)
})
