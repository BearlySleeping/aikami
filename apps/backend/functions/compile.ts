// apps/backend/functions/compile.ts

import { ensureDir } from 'https://deno.land/std@0.224.0/fs/ensure_dir.ts'
import { copy } from 'https://deno.land/std@0.224.0/fs/copy.ts'

// --- Configuration & Paths ---

/** Base directory for all build output */
const DIST_DIR = new URL('./dist/', import.meta.url)
/** Directory for the bundled function source code */
const DIST_SRC_DIR = new URL('./dist/src/', import.meta.url)
/** Path to the source entrypoint file */
const INPUT_FILE = new URL('./src/controllers/api/test.ts', import.meta.url)
/** Path for the final bundled JavaScript file */
const OUTPUT_FILE = new URL('./dist/src/index.js', import.meta.url)
/** Path to the root .env file (assuming it's 3 levels up from this script) */
const ENV_SOURCE_PATH = new URL('.env', import.meta.url)
/** Path for the copied .env file in the dist folder */
const ENV_DEST_PATH = new URL('./dist/.env', import.meta.url)

// --- Build Steps ---

/**
 * Ensures the 'dist' and 'dist/src' directories exist.
 */
async function setupDirectories(): Promise<void> {
  console.log('Ensuring output directories exist...')
  await ensureDir(DIST_DIR.pathname)
  await ensureDir(DIST_SRC_DIR.pathname)
}

/**
 * Creates the 'dist/firebase.json' file.
 */
async function createFirebaseConfig(): Promise<void> {
  const firebaseJsonPath = new URL('./dist/firebase.json', import.meta.url)
  const firebaseJsonContent = {
    functions: {
      source: '.', // Tells Firebase to look in this dir
    },
  }
  await Deno.writeTextFile(
    firebaseJsonPath.pathname,
    JSON.stringify(firebaseJsonContent, null, 2),
  )
  console.log('Created dist/firebase.json')
}

/**
 * Creates the 'dist/package.json' file required by Firebase Node.js runtime.
 */
async function createPackageJson(): Promise<void> {
  const packageJsonPath = new URL('./dist/package.json', import.meta.url)
  const packageJsonContent = {
    type: 'module',
    main: 'src/index.js', // Points to our bundled output
    engines: {
      node: '22', // Specify Node.js 22
    },
    dependencies: {
      'firebase-admin': '^13.5.0',
      'firebase-functions': '^6.6.0',
    },
  }
  await Deno.writeTextFile(
    packageJsonPath.pathname,
    JSON.stringify(packageJsonContent, null, 2),
  )
  console.log('Created dist/package.json')
}

/**
 * Bundles the Deno source code into a single ES module for Node.js.
 */
async function bundleCode(): Promise<void> {
  console.log(`Bundling ${INPUT_FILE.pathname}...`)

  const result = await Deno.bundle({
    external: [
      'firebase-admin',
      'firebase-functions',
    ],
    // minify: true,
    // inlineImports: false,
    // sourcemap: 'external',
    // packages: 'bundle',
    // format: 'esm',
    // platform: 'deno',
    // write: true,
    // codeSplitting: false,
    entrypoints: [INPUT_FILE.pathname],
    // outputDir: DIST_SRC_DIR.pathname,
    outputPath: OUTPUT_FILE.pathname,
  })

  console.log('Bundle success:', result.success)
}

/**
 * Copies the .env file from the project root to the 'dist' folder.
 *
 * 🚨 **SECURITY WARNING** 🚨
 * This is generally **NOT** recommended for Firebase.
 * Your .env file contains secrets, and bundling it with your function
 * code is a security risk.
 *
 * The **CORRECT** way is to use Firebase runtime configuration:
 * `firebase functions:config:set my_service.key="SECRET_VALUE"`
 */
async function copyEnvFile(): Promise<void> {
  console.warn(
    '🚨 WARNING: Copying .env file. This is NOT recommended for production!',
  )
  console.warn(
    'Consider using `firebase functions:config:set` for secrets.',
  )
  try {
    await copy(ENV_SOURCE_PATH.pathname, ENV_DEST_PATH.pathname, {
      overwrite: true,
    })
    console.log('Copied .env file to dist/')
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(
        `Could not find .env file at ${ENV_SOURCE_PATH.pathname}, skipping copy.`,
      )
    } else {
      throw error
    }
  }
}

await setupDirectories()
await createFirebaseConfig()
await createPackageJson()
await bundleCode()
await copyEnvFile() // This is the step you requested

console.log('\n✅ Build complete!')
