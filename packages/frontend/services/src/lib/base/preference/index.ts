import { BaseClass } from '@aikami/utils'

export type CorePreferenceProviderInterface<
  PreferenceRecords extends Record<string, unknown> = Record<string, unknown>,
> = {
  set<Key extends keyof PreferenceRecords>(
    key: Key,
    value?: PreferenceRecords[Key],
  ): Promise<void>

  get<Key extends keyof PreferenceRecords>(
    key: Key,
  ): Promise<PreferenceRecords[Key] | undefined>

  delete<Key extends keyof PreferenceRecords>(key: Key): Promise<void>

  clear(): Promise<void>

  entries(): Promise<
    [keyof PreferenceRecords, PreferenceRecords[keyof PreferenceRecords]][]
  >
}

export abstract class CorePreferenceProviderService<
  PreferenceRecords extends Record<string, unknown>,
> extends BaseClass implements CorePreferenceProviderInterface<PreferenceRecords> {
  private static _preferenceProvider?: CorePreferenceProviderInterface

  async clear(): Promise<void> {
    const preferenceProvider = await this._getPreferenceProvider()
    return preferenceProvider.clear()
  }

  async entries(): Promise<
    [keyof PreferenceRecords, PreferenceRecords[keyof PreferenceRecords]][]
  > {
    const preferenceProvider = await this._getPreferenceProvider()
    return preferenceProvider.entries()
  }

  async set<Key extends keyof PreferenceRecords>(
    key: Key,
    value?: PreferenceRecords[Key],
  ): Promise<void> {
    const preferenceProvider = await this._getPreferenceProvider()
    if (value === undefined) {
      return preferenceProvider.delete(key)
    } else {
      return preferenceProvider.set(key, value)
    }
  }

  async get<Key extends keyof PreferenceRecords>(
    key: Key,
  ): Promise<PreferenceRecords[Key] | undefined> {
    const preferenceProvider = await this._getPreferenceProvider()
    return preferenceProvider.get(key)
  }

  async delete<Key extends keyof PreferenceRecords>(key: Key): Promise<void> {
    const preferenceProvider = await this._getPreferenceProvider()
    return preferenceProvider.delete(key)
  }

  private async _getPreferenceProvider(): Promise<
    CorePreferenceProviderInterface<PreferenceRecords>
  > {
    if (CorePreferenceProviderService._preferenceProvider) {
      return CorePreferenceProviderService._preferenceProvider as CorePreferenceProviderInterface<
        PreferenceRecords
      >
    }
    if (
      typeof window !== 'undefined' &&
      'indexedDB' in window &&
      globalThis.self === globalThis.top
    ) {
      CorePreferenceProviderService._preferenceProvider = (
        await import('./indexed-db.ts')
      ).default
    } else {
      CorePreferenceProviderService._preferenceProvider = (
        await import('./local-storage.ts')
      ).default
    }

    return CorePreferenceProviderService._preferenceProvider as CorePreferenceProviderInterface<
      PreferenceRecords
    >
  }
}
