import '../../src/logger.ts';
import { onRequest } from 'firebase-functions/https';
import func_prompt_ai from '../../src/controllers/api/prompt_ai.ts';
import { region } from 'firebase-functions/v1';
import func_created from '../../src/controllers/auth/created.ts';
import func_deleted from '../../src/controllers/auth/deleted.ts';
import { onCall } from 'firebase-functions/https';
import func_ai from '../../src/controllers/callable/ai.ts';
import func_auth from '../../src/controllers/callable/auth.ts';
import func_chat from '../../src/controllers/callable/chat.ts';
import { onDocumentCreated } from 'firebase-functions/firestore';
import func_users_created from '../../src/controllers/firestore/users/[uid]/created.ts';
import { onDocumentDeleted } from 'firebase-functions/firestore';
import func_users_deleted from '../../src/controllers/firestore/users/[uid]/deleted.ts';
import { onDocumentUpdated } from 'firebase-functions/firestore';
import func_users_updated from '../../src/controllers/firestore/users/[uid]/updated.ts';
import { onSchedule } from 'firebase-functions/scheduler';
import func_daily from '../../src/controllers/scheduler/daily.ts';

export const prompt_ai = onRequest({
  "region": "europe-west1"
}, func_prompt_ai);
export const created = region("europe-west1").auth.user().onCreate(func_created);
export const deleted = region("europe-west1").auth.user().onDelete(func_deleted);
export const ai = onCall({
  "region": "europe-west1",
  "memory": "512MiB",
  "timeoutSeconds": 120
}, func_ai);
export const auth = onCall({
  "region": "europe-west1",
  "memory": "256MiB",
  "timeoutSeconds": 60
}, func_auth);
export const chat = onCall({
  "region": "europe-west1",
  "memory": "256MiB",
  "timeoutSeconds": 120
}, func_chat);
export const users_created = onDocumentCreated({
  "region": "europe-west1",
  "document": "users/{uid}"
}, func_users_created);
export const users_deleted = onDocumentDeleted({
  "region": "europe-west1",
  "document": "users/{uid}"
}, func_users_deleted);
export const users_updated = onDocumentUpdated({
  "region": "europe-west1",
  "document": "users/{uid}"
}, func_users_updated);
export const daily = onSchedule({
  "schedule": "every day 00:00",
  "region": "us-central1",
  "memory": "256MiB",
  "timeoutSeconds": 540
}, func_daily);
