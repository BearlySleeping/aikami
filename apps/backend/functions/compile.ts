// apps/backend/functions/compile.ts

import { cp, mkdir, writeFile } from 'node:fs/promises';

// --- Configuration & Paths ---

/** Base directory for all build output */
const DIST_DIR = './dist';
/** Directory for the bundled function source code */
const DIST_SRC_DIR = './dist/src';
/** Path to the source entrypoint file */
const INPUT_FILE = './src/controllers/api/test.ts';
/** Path for the final bundled JavaScript file */
const _OUTPUT_FILE = './dist/src/index.js';
/** Path to the root .env file */
const ENV_SOURCE_PATH = '../../.env';
/** Path for the copied .env file in the dist folder */
const ENV_DEST_PATH = './dist/.env';

// --- Build Steps ---

/**
 * Ensures the 'dist' and 'dist/src' directories exist.
 */
async function setupDirectories(): Promise<void> {
  console.log('Ensuring output directories exist...');
  await mkdir(DIST_DIR, { recursive: true });
  await mkdir(DIST_SRC_DIR, { recursive: true });
}

/**
 * Creates the 'dist/firebase.json' file.
 */
async function createFirebaseConfig(): Promise<void> {
  const firebaseJsonPath = './dist/firebase.json';
  const firebaseJsonContent = {
    functions: {
      source: '.', // Tells Firebase to look in this dir
    },
  };
  await writeFile(firebaseJsonPath, JSON.stringify(firebaseJsonContent, null, 2));
  console.log('Created dist/firebase.json');
}

/**
 * Creates the 'dist/package.json' file required by Firebase Node.js runtime.
 */
async function createPackageJson(): Promise<void> {
  const packageJsonPath = './dist/package.json';
  const packageJsonContent = {
    type: 'module',
    main: 'src/index.js', // Points to our bundled output
    engines: {
      node: '22', // Specify Node.js 22
    },
    dependencies: {
      'firebase-admin': '^12.1.0',
      'firebase-functions': '^5.0.1',
    },
  };
  await writeFile(packageJsonPath, JSON.stringify(packageJsonContent, null, 2));
  console.log('Created dist/package.json');
}

/**
 * Bundles the Deno source code into a single ES module for Node.js.
 */
async function bundleCode(): Promise<void> {
  console.log(`Bundling ${INPUT_FILE}...`);

  const result = await Bun.build({
    entrypoints: [INPUT_FILE],
    outdir: DIST_SRC_DIR,
    target: 'node',
    external: ['firebase-admin', 'firebase-functions'],
  });

  if (!result.success) {
    console.error('Bundle failed:');
    for (const message of result.logs) {
      console.error(message);
    }
    process.exit(1);
  }

  console.log('Bundle success!');
}

/**
 * Copies the .env file from the project root to the 'dist' folder.
 */
async function copyEnvFile(): Promise<void> {
  console.warn('🚨 WARNING: Copying .env file. This is NOT recommended for production!');
  console.warn('Consider using `firebase functions:config:set` for secrets.');
  try {
    await cp(ENV_SOURCE_PATH, ENV_DEST_PATH);
    console.log('Copied .env file to dist/');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`Could not find .env file at ${ENV_SOURCE_PATH}, skipping copy.`);
    } else {
      throw error;
    }
  }
}

await setupDirectories();
await createFirebaseConfig();
await createPackageJson();
await bundleCode();
await copyEnvFile();

console.log('\n✅ Build complete!');
