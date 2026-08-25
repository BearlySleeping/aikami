// apps/frontend/client/src/env.d.ts
import type { LogLevel, Mode } from '@nordclaw/types';

declare module '*?worker&type=module' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

declare module '$env/static/private' {
  export const GEMINI_API_KEY: string;
  export const MODE: Mode;
  export const LOG_LEVEL: Mode;
  export const GMAIL_CLIENT_ID: string;
  export const GMAIL_CLIENT_SECRET: string;
}
declare module '$env/static/public' {
  /** Base URL for the voice/TTS microservice (Kokoro container). */
  export const PUBLIC_VOICE_URL: string;
  /** Public base URL for the R2 assets bucket (e.g. https://assets.bearlysleeping.com). */
  export const PUBLIC_ASSETS_BASE_URL: string;
  /** Build-time flag: when 'true', restores full asset bundling (C-435 AC-7). */
  export const PUBLIC_FULL_BUNDLE: string;
  export const PUBLIC_LOG_LEVEL: LogLevel;
  export const PUBLIC_MODE: Mode;
}
