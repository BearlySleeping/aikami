import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import app from './app.ts';

export { httpsCallable } from 'firebase/functions';

// TODO add region to env
const region: string = import.meta.env.PUBLIC_CLOUD_FUNCTIONS_REGION || 'europe-west1';

export const functions = getFunctions(app, region);

if (import.meta.env.PUBLIC_FLAVOR === 'EMULATOR') {
  connectFunctionsEmulator(functions, 'localhost', 5001);
}
