import { getRemoteConfig } from 'firebase/remote-config'
import app from './app.ts'
export { activate, fetchAndActivate, getAll, isSupported } from 'firebase/remote-config'

export const remoteConfig = getRemoteConfig(app)
