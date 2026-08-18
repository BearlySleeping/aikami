// apps/backend/firebase/scripts/bucket.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI script — console is the interface */
import { getBucket } from '@aikami/backend/configs/bucket.ts';

const bucket = getBucket();

const response = await bucket.file('banana.webp').get();
const file = response[0];

const url = await file.getSignedUrl({
  action: 'read',
  expires: Date.now() + 1000 * 60 * 60 * 24 * 365,
});

console.log('url:', url[0]);
