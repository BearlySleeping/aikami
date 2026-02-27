import { BaseClass, type BaseClassInterface } from '@aikami/utils';
import type { Value } from 'firebase/remote-config';

type RemoteConfig = typeof import('./configs/remote-config.ts');

export type FirebaseRemoteConfigServiceInterface = {
  initialize(): Promise<boolean>;
  isSupported(): Promise<boolean>;
  getAll(): Promise<Record<string, Value>>;
} & BaseClassInterface;

class FirebaseRemoteConfigService
  extends BaseClass
  implements FirebaseRemoteConfigServiceInterface
{
  private static _remoteConfig?: RemoteConfig;

  constructor() {
    super({
      className: 'RemoteConfigService',
    });
  }

  async initialize(): Promise<boolean> {
    const { fetchAndActivate, isSupported, remoteConfig } = await this._getRemoteConfig();
    if (!(await isSupported())) {
      return false;
    }

    remoteConfig.settings.minimumFetchIntervalMillis = 3600000;
    remoteConfig.settings.fetchTimeoutMillis = 60000;

    await fetchAndActivate(remoteConfig);

    return true;
  }

  async getAll(): Promise<Record<string, Value>> {
    const { getAll, remoteConfig } = await this._getRemoteConfig();

    return getAll(remoteConfig);
  }

  async isSupported(): Promise<boolean> {
    const { isSupported } = await this._getRemoteConfig();

    return isSupported();
  }

  private async _getRemoteConfig(): Promise<RemoteConfig> {
    if (FirebaseRemoteConfigService._remoteConfig) {
      return FirebaseRemoteConfigService._remoteConfig;
    }

    if (import.meta.env.SSR || typeof window === 'undefined' || import.meta.env.STORYBOOK) {
      throw new Error(`${this._className} is not available on SSR`);
    }

    FirebaseRemoteConfigService._remoteConfig = await import('./configs/remote-config.ts');
    return FirebaseRemoteConfigService._remoteConfig;
  }
}

export const firebaseRemoteConfigService = new FirebaseRemoteConfigService();
