// packages/frontend/configs/src/lib/data_connect.ts

import {
  type ConnectorConfig,
  connectDataConnectEmulator,
  type DataConnect,
  getDataConnect as fbGetDataConnect,
} from 'firebase/data-connect';
import app from './app';
import { EMULATOR_PORTS, isEmulatorModePublic } from './environment';

// note we do not want to cache dataConnect, in case we have multiple connectors
export const getDataConnect = (config: ConnectorConfig): DataConnect => {
  const instance = fbGetDataConnect(app, config);

  // Connect to emulator — only do this once
  if (isEmulatorModePublic()) {
    connectDataConnectEmulator(instance, 'localhost', EMULATOR_PORTS.dataconnect);
  }

  return instance;
};
