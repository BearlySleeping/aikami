// packages/frontend/configs/src/lib/functions.ts
import { CLOUD_FUNCTIONS_REGION, EMULATOR_PORTS } from '@aikami/constants';
import { connectFunctionsEmulator, type Functions, getFunctions } from 'firebase/functions';
import app from './app.ts';
import { isEmulatorModePublic } from './environment.ts';

export { httpsCallable } from 'firebase/functions';

const initializeFunctionsInstance = (): Functions => {
  const instance = getFunctions(app, CLOUD_FUNCTIONS_REGION);

  if (isEmulatorModePublic()) {
    connectFunctionsEmulator(instance, 'localhost', EMULATOR_PORTS.functions);
  }

  return instance;
};

export const functions = initializeFunctionsInstance();
