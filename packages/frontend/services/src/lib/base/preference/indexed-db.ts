import type { CorePreferenceProviderInterface } from './index.ts'
import { clear, del, entries, get, set } from 'idb-keyval'

class PreferenceService<PreferenceRecords extends Record<string, unknown>>
  implements CorePreferenceProviderInterface<PreferenceRecords> {
  async entries(): Promise<
    [keyof PreferenceRecords, PreferenceRecords[keyof PreferenceRecords]][]
  > {
    return (await entries()) as [
      keyof PreferenceRecords,
      PreferenceRecords[keyof PreferenceRecords],
    ][]
  }
  async set<Key extends keyof PreferenceRecords>(
    key: Key,
    value: PreferenceRecords[Key],
  ): Promise<void> {
    return await set(key as Extract<Key, 'string'>, value)
  }
  async get<Key extends keyof PreferenceRecords>(
    key: Key,
  ): Promise<PreferenceRecords[Key] | undefined> {
    return await get(key as Extract<Key, 'string'>)
  }
  async delete<Key extends keyof PreferenceRecords>(key: Key): Promise<void> {
    return await del(key as Extract<Key, 'string'>)
  }
  async clear(): Promise<void> {
    return await clear()
  }
}

export default new PreferenceService()
