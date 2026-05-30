// packages/frontend/configs/src/lib/remote_config.ts
import { getRemoteConfig, type RemoteConfig } from 'firebase/remote-config';
import app from './app.ts';

export {
  activate,
  fetchAndActivate,
  getAll,
  isSupported,
} from 'firebase/remote-config';

export const initializeRemoteConfigInstance = (): RemoteConfig => {
  return getRemoteConfig(app);
};

export const remoteConfig = initializeRemoteConfigInstance();
