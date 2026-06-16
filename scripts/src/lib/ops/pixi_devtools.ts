// scripts/src/lib/ops/pixi_devtools.ts
//
// PixiJS DevTools Chrome Extension manager.
//
// Handles downloading, unpacking, finding, and updating the PixiJS DevTools
// extension from GitHub releases. Used by the preview script to load the
// devtools into Chromium alongside the Aikami client.
//
// Public API:
//   ensureDevtools()     - ensure devtools are installed, return extension dir
//   updateDevtools()     - force re-download and unpack
//   getDevtoolsPath()    - return the current extension dir (or null)

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ── Constants ──────────────────────────────────────────────────────────────

const PIXI_DEVTOOLS_DIR = resolve(homedir(), '.local/share/aikami/pixi-devtools');
const PIXI_DEVTOOLS_VERSION_FILE = join(PIXI_DEVTOOLS_DIR, '.version');
const PIXI_DEVTOOLS_RELEASE_URL =
  'https://github.com/pixijs/devtools/releases/latest/download/chrome.zip';

// ── Logging helpers ────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const info = (msg: string) => console.log(`  [pixi-devtools] ${msg}`);
const ok = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const warn = (msg: string) => console.warn(`  ${YELLOW}⚠${RESET} ${msg}`);
const err = (msg: string) => console.error(`  ${RED}✗${RESET} ${msg}`);

// ── Find manifest directory ────────────────────────────────────────────────

/** Walk a directory tree and find the first directory containing manifest.json. */
const findManifestDir = (root: string): string | null => {
  if (!existsSync(root)) {
    return null;
  }

  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (!dir) {
      continue;
    }
    try {
      const entries = execSync(
        `find "${dir}" -name manifest.json -printf '%h\n' -quit 2>/dev/null`,
        {
          encoding: 'utf-8',
          cwd: root,
        },
      ).trim();
      if (entries) {
        return entries;
      }
    } catch {
      // find may fail on some dirs, skip
    }
    // Fallback: manual walk using Node
    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name === 'manifest.json') {
          return dir;
        }
        if (item.isDirectory()) {
          queue.push(join(dir, item.name));
        }
      }
    } catch {
      // Permission errors on some dirs — skip
    }
  }
  return null;
};

// ── Download and unpack ────────────────────────────────────────────────────

/**
 * Download the latest PixiJS DevTools from GitHub releases and unpack to
 * the destination directory. Returns the path to the extension directory
 * (where manifest.json lives), or null on failure.
 */
const downloadAndUnpack = (): string | null => {
  // Clean and recreate the devtools directory
  if (existsSync(PIXI_DEVTOOLS_DIR)) {
    rmSync(PIXI_DEVTOOLS_DIR, { recursive: true, force: true });
  }
  mkdirSync(PIXI_DEVTOOLS_DIR, { recursive: true });

  info('Downloading PixiJS DevTools from GitHub releases…');

  // Write a small Python script to a temp file for clean execution
  const scriptPath = join(tmpdir(), 'aikami-pixi-devtools-download.py');
  const pythonCode = [
    'import urllib.request, zipfile, io, os, sys',
    '',
    'dest_root = os.path.expanduser(sys.argv[1])',
    '',
    'try:',
    `    data = urllib.request.urlopen("${PIXI_DEVTOOLS_RELEASE_URL}", timeout=30).read()`,
    'except Exception as e:',
    '    print(f"DOWNLOAD_ERROR:{e}", file=sys.stderr)',
    '    sys.exit(1)',
    '',
    'try:',
    '    with zipfile.ZipFile(io.BytesIO(data)) as zf:',
    '        zf.extractall(dest_root)',
    'except Exception as e:',
    '    print(f"EXTRACT_ERROR:{e}", file=sys.stderr)',
    '    sys.exit(2)',
    '',
    '# Find manifest.json',
    'for root, dirs, files in os.walk(dest_root):',
    "    if 'manifest.json' in files:",
    '        print(root)',
    '        sys.exit(0)',
    '',
    'print("MANIFEST_NOT_FOUND", file=sys.stderr)',
    'sys.exit(3)',
  ].join('\n');

  writeFileSync(scriptPath, pythonCode, 'utf-8');

  try {
    const result = execSync(`python3 "${scriptPath}" "${PIXI_DEVTOOLS_DIR}"`, {
      encoding: 'utf-8',
      timeout: 60_000,
    }).trim();

    if (result && existsSync(join(result, 'manifest.json'))) {
      // Write version marker
      writeFileSync(PIXI_DEVTOOLS_VERSION_FILE, 'installed', 'utf-8');
      ok(`PixiJS DevTools installed to ${result}`);
      return result;
    }

    warn('Devtools archive unpacked but manifest.json not found');
    return null;
  } catch (e) {
    err(`Download/unpack failed: ${e}`);
    return null;
  } finally {
    // Clean up temp script
    try {
      rmSync(scriptPath, { force: true });
    } catch {
      // ignore
    }
  }
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Ensure PixiJS DevTools extension is installed.
 * Downloads and unpacks if not already present.
 * Returns the extension directory path, or null on failure.
 */
export const ensureDevtools = (): string | null => {
  // Already installed?
  if (existsSync(PIXI_DEVTOOLS_VERSION_FILE)) {
    const manifestDir = findManifestDir(PIXI_DEVTOOLS_DIR);
    if (manifestDir && existsSync(join(manifestDir, 'manifest.json'))) {
      return manifestDir;
    }
    // Version file exists but no manifest — dir may be corrupted
    warn('Devtools version marker found but manifest.json missing — re-downloading…');
  }

  return downloadAndUnpack();
};

/**
 * Force re-download and unpack the latest PixiJS DevTools.
 * Returns the extension directory path, or null on failure.
 */
export const updateDevtools = (): string | null => {
  info('Force-updating PixiJS DevTools…');
  if (existsSync(PIXI_DEVTOOLS_VERSION_FILE)) {
    rmSync(PIXI_DEVTOOLS_VERSION_FILE, { force: true });
  }
  return downloadAndUnpack();
};

/**
 * Get the current PixiJS DevTools extension directory path.
 * Returns null if not installed.
 */
export const getDevtoolsPath = (): string | null => {
  if (!existsSync(PIXI_DEVTOOLS_VERSION_FILE)) {
    return null;
  }
  const manifestDir = findManifestDir(PIXI_DEVTOOLS_DIR);
  if (manifestDir && existsSync(join(manifestDir, 'manifest.json'))) {
    return manifestDir;
  }
  return null;
};
