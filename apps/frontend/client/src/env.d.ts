// apps/frontend/client/src/env.d.ts
import type { LogLevel, Mode } from '@nordclaw/types';

declare module '*?worker&type=module' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

declare module '$env/static/private' {
  export const GEMINI_API_KEY: string;
  export const FIREBASE_SERVICE_ACCOUNT: string;
  export const MODE: Mode;
  export const LOG_LEVEL: Mode;
  export const GMAIL_CLIENT_ID: string;
  export const GMAIL_CLIENT_SECRET: string;
}
declare module '$env/static/public' {
  /** Base URL for the voice/TTS microservice (Kokoro container). */
  export const PUBLIC_VOICE_URL: string;
  export const PUBLIC_FIREBASE_API_KEY: string;
  export const PUBLIC_FIREBASE_AUTH_DOMAIN: string;
  export const PUBLIC_FIREBASE_STORAGE_BUCKET: string;
  export const PUBLIC_FIREBASE_MESSAGING_SENDER_ID: string;
  export const PUBLIC_FIREBASE_APP_ID: string;
  export const PUBLIC_FIREBASE_MEASUREMENT_ID: string;
  export const PUBLIC_LOG_LEVEL: LogLevel;
  export const PUBLIC_MODE: Mode;
}
