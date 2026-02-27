import logger from '$logger';
import type { CorePreferenceProviderInterface } from './index.ts';

export class PreferenceService<PreferenceRecords extends Record<string, unknown>>
  implements CorePreferenceProviderInterface<PreferenceRecords>
{
  async clear(): Promise<void> {
    localStorage.clear();
    return await Promise.resolve();
  }
  async entries(): Promise<
    [keyof PreferenceRecords, PreferenceRecords[keyof PreferenceRecords]][]
  > {
    const entries: [keyof PreferenceRecords, PreferenceRecords[keyof PreferenceRecords]][] = [];

    for (const [key, value] of Object.entries(localStorage)) {
      if (
        typeof value !== 'string' ||
        !value.startsWith('{') ||
        !value.endsWith('}') ||
        !value.includes('value')
      ) {
        continue;
      }

      try {
        const parsedValue = JSON.parse(value);

        entries.push([
          key,
          (
            parsedValue as {
              value: PreferenceRecords[keyof PreferenceRecords];
            }
          ).value,
        ]);
      } catch (error) {
        logger.error('[PreferenceService]: failed to get localStorage entry', {
          error,
          key,
          value,
        });
      }
    }
    return await Promise.resolve(entries);
  }

  async set<Key extends keyof PreferenceRecords>(
    key: Key,
    value: PreferenceRecords[Key],
  ): Promise<void> {
    localStorage.setItem(key as Extract<Key, 'string'>, JSON.stringify({ value }));
    return await Promise.resolve();
  }

  async get<Key extends keyof PreferenceRecords>(
    key: Key,
  ): Promise<PreferenceRecords[Key] | undefined> {
    const value = localStorage.getItem(key as Extract<Key, 'string'>);
    if (!value) {
      return await Promise.resolve(undefined);
    }
    const parsedValue = JSON.parse(value);
    return (
      parsedValue as {
        value: PreferenceRecords[Key];
      }
    ).value;
  }

  async delete<Key extends keyof PreferenceRecords>(key: Key): Promise<void> {
    localStorage.removeItem(key as Extract<Key, 'string'>);
    return await Promise.resolve();
  }
}

export default new PreferenceService();
