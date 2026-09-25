// apps/frontend/client/scripts/check_no_eruda.ts

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import process from 'node:process';
import { logger } from '@aikami/logger';

const BUILD_DIR = resolve(import.meta.dir, '..', 'build');
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);
// The env schema legitimately retains the PUBLIC_ERUDA_ENABLED key. Assert
// the runtime module and its logger dependency are absent instead of matching
// that harmless configuration identifier.
const DEBUG_MARKERS = ['eruda.init', 'loglevel-plugin'];

const collectBuildFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return await collectBuildFiles(path);
      }
      return TEXT_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
};

const files = await collectBuildFiles(BUILD_DIR);
const offenders: string[] = [];
for (const file of files) {
  const contents = await readFile(file, 'utf8');
  if (DEBUG_MARKERS.some((marker) => contents.toLowerCase().includes(marker))) {
    offenders.push(file);
  }
}

if (offenders.length > 0) {
  logger.error(
    `Production client bundle contains debug-console markers: ${offenders.map((file) => file.replace(`${BUILD_DIR}/`, '')).join(', ')}`,
  );
  process.exit(1);
}

logger.info(`check-no-eruda: production bundle clean (${files.length} text assets scanned)`);
