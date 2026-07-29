#!/usr/bin/env bun
// scripts/src/lib/setup/firebase_setup.ts
//
// Firebase project setup: Firestore, Firebase Storage.
// Requires Firebase to already be enabled on the GCP project.
//
// Usage:
//   bun run scripts/src/lib/setup/firebase_setup.ts --mode=staging
//   bun run scripts/src/lib/setup/firebase_setup.ts --mode=production --dry-run

import { c, fmt, parseCliArgs, run } from '../cli_utils';
import { MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };
type ManualStep = { title: string; url?: string; commands?: string[]; detail?: string };

const FIREBASE_API = 'https://firebase.googleapis.com/v1beta1';
const FIRESTORE_API = 'https://firestore.googleapis.com/v1';

async function gcloudToken(): Promise<string> {
  const { out, code } = await run(['gcloud', 'auth', 'print-access-token', '--quiet']);
  if (code !== 0 || !out) {
    throw new Error('gcloud auth failed — run: gcloud auth login');
  }
  return out.trim();
}

const checkFirebase = async (projectId: string): Promise<boolean> => {
  const token = await gcloudToken();
  const res = await fetch(`${FIREBASE_API}/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': projectId },
  });
  return res.ok;
};

const checkFirestore = async (projectId: string): Promise<boolean> => {
  const token = await gcloudToken();
  const res = await fetch(`${FIRESTORE_API}/projects/${projectId}/databases/(default)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
};

const checkStorageBucket = async (projectId: string): Promise<boolean> => {
  const bucketName = `${projectId}.appspot.com`;
  const { code } = await run([
    'gcloud',
    'storage',
    'buckets',
    'describe',
    `gs://${bucketName}`,
    `--project=${projectId}`,
    '--quiet',
  ]);
  return code === 0;
};

const createStorageBucket = async (projectId: string): Promise<boolean> => {
  const { code } = await run([
    'gcloud',
    'storage',
    'buckets',
    'create',
    `gs://${projectId}.appspot.com`,
    `--project=${projectId}`,
    '--location=eur4',
    '--uniform-bucket-level-access',
    '--quiet',
  ]);
  return code === 0;
};

export const setupFirebase = async (
  projectId: string,
  dryRun: boolean,
): Promise<{ checks: Check[]; manualSteps: ManualStep[] }> => {
  const checks: Check[] = [];
  const manualSteps: ManualStep[] = [];

  console.log(fmt.section('Firebase'));
  const fbOk = await checkFirebase(projectId);
  if (fbOk) {
    console.log(fmt.ok('Firebase enabled on project'));
    checks.push({ name: 'Firebase project', status: 'ok' });
  } else {
    console.log(fmt.warn('Firebase not enabled'));
    checks.push({ name: 'Firebase project', status: 'missing' });
    manualSteps.push({
      title: 'Enable Firebase on the project',
      url: `https://console.firebase.google.com/?dlAction=MigrateCloudProject&cloudProjectNumber=${projectId}`,
      detail: 'Click "Add Firebase" and follow the wizard.',
    });
  }

  console.log(fmt.section('Firestore'));
  const fsOk = await checkFirestore(projectId);
  if (fsOk) {
    console.log(fmt.ok('Firestore (default) database exists'));
    checks.push({ name: 'Firestore database', status: 'ok' });
  } else {
    console.log(fmt.warn('Firestore (default) not found'));
    checks.push({ name: 'Firestore database', status: 'missing' });
    manualSteps.push({
      title: 'Create Firestore (Native mode, europe-west1)',
      url: `https://console.firebase.google.com/project/${projectId}/firestore`,
      commands: [
        `gcloud firestore databases create --project=${projectId} --location=europe-west1 --type=firestore-native`,
      ],
    });
  }

  console.log(fmt.section('Firebase Storage'));
  const storageOk = await checkStorageBucket(projectId);
  if (storageOk) {
    console.log(fmt.ok('Default Storage bucket exists'));
    checks.push({ name: 'Storage bucket', status: 'ok' });
  } else {
    console.log(fmt.fix('Creating default Storage bucket (eur4)...'));
    if (!dryRun) {
      const ok = await createStorageBucket(projectId);
      if (ok) {
        console.log(fmt.ok('Storage bucket created'));
        checks.push({ name: 'Storage bucket', status: 'missing', fixed: true });
      } else {
        console.log(fmt.err('Failed to create Storage bucket'));
        checks.push({ name: 'Storage bucket', status: 'error' });
      }
    } else {
      console.log(fmt.fix('Would create Storage bucket (dry-run)'));
      checks.push({ name: 'Storage bucket', status: 'missing', fixed: true });
    }
  }

  return { checks, manualSteps };
};

if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string' },
    'dry-run': { type: 'boolean' },
  });
  const mode = (opts.mode as string) ?? 'staging';
  const dryRun = opts['dry-run'] as boolean;
  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error('Unknown mode');
    process.exit(1);
  }

  console.log(fmt.head(`Firebase Setup — ${mode} (${projectId})`));
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode.\n'));
  }

  const { checks, manualSteps } = await setupFirebase(projectId, dryRun);
  const ok = checks.filter((c) => c.status === 'ok').length;
  const fixed = checks.filter((c) => c.fixed).length;
  console.log(fmt.head('Summary'));
  console.log(`  ${c.green}${ok}${c.reset} already set up, ${c.cyan}${fixed}${c.reset} fixed`);
  if (manualSteps.length) {
    console.log(fmt.head(`Manual Steps (${manualSteps.length})`));
    for (let i = 0; i < manualSteps.length; i++) {
      console.log(`  ${i + 1}. ${manualSteps[i].title}\n     ${manualSteps[i].url ?? ''}`);
    }
  }
}
