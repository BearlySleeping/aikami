import { unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { $, file, Glob } from 'bun';

// --- CONFIGURATION ---
// Bun natively supports import.meta.dir, replacing dirname(fileURLToPath(import.meta.url))
const scriptsDirectory = import.meta.dir;
const projectRoot = resolve(scriptsDirectory, '..');
const assetsPath = resolve(projectRoot, 'src/assets');
const searchPath = resolve(projectRoot, 'src');
const supportedExtensions = ['.png', '.jpg', '.jpeg', '.webp'];

// Conversion Settings
const CONVERSION_QUALITY = 80;
const ENCODING_SPEED = 5;
// --- END CONFIGURATION ---

/**
 * Converts an image to AVIF format using the 'magick' command-line tool.
 */
async function convertToAvif(imagePath: string): Promise<string> {
  const ext = extname(imagePath);
  const outputFileName = `${basename(imagePath, ext)}.avif`;
  const outputPath = join(dirname(imagePath), outputFileName);

  const hasAlpha = await hasAlphaChannel(imagePath);

  // Bun Shell ($) automatically escapes variables, so we no longer need to wrap paths in quotes!
  if (hasAlpha) {
    await $`magick ${imagePath} -strip -quality ${CONVERSION_QUALITY} -define heic:speed=${ENCODING_SPEED} -background none ${outputPath}`.quiet();
  } else {
    await $`magick ${imagePath} -strip -quality ${CONVERSION_QUALITY} -define heic:speed=${ENCODING_SPEED} ${outputPath}`.quiet();
  }
  return outputPath;
}

/**
 * Searches for and replaces all references to an old filename with a new one.
 */
async function findAndReplaceReferences(
  oldFilename: string,
  newFilename: string,
): Promise<boolean> {
  let referenceFound = false;
  const glob = new Glob('**/*.*');
  const searchRegex = new RegExp(oldFilename.replace('.', '\\.'), 'g');

  for await (const relativeFile of glob.scan({ cwd: searchPath, onlyFiles: true })) {
    const absolutePath = join(searchPath, relativeFile);

    // Replicating the 'ignore' array from the npm glob package
    if (absolutePath.includes(assetsPath) || absolutePath.includes('node_modules')) {
      continue;
    }

    try {
      const targetFile = file(absolutePath);
      let content = await targetFile.text(); // Bun's native way to read a file to a string

      if (searchRegex.test(content)) {
        const oldContent = content;
        content = content.replace(searchRegex, newFilename);

        if (oldContent !== content) {
          await Bun.write(targetFile, content); // Bun's native fast file writer
          referenceFound = true;
        }
      }
    } catch (_e) {
      // Could be a binary file or a file with restricted access, safe to ignore.
    }
  }
  return referenceFound;
}

/**
 * Checks if an image has an alpha channel (transparency).
 */
async function hasAlphaChannel(imagePath: string): Promise<boolean> {
  try {
    // Bun Shell natively returns stdout/stderr objects
    const result = await $`magick identify -format '%[alpha]' ${imagePath}`.quiet();
    return result.text().trim() === 'True';
  } catch (_error) {
    return false;
  }
}

/** Main function to orchestrate the image optimization process. */
async function processImages() {
  const extPattern = supportedExtensions.map((ext) => ext.slice(1)).join(',');
  const glob = new Glob(`**/*.{${extPattern}}`);

  const imagePaths: string[] = [];
  for await (const relativeFile of glob.scan({ cwd: assetsPath, onlyFiles: true })) {
    imagePaths.push(join(assetsPath, relativeFile));
  }

  if (imagePaths.length === 0) {
    return;
  }
  const unreferencedImages: string[] = [];

  for (const imagePath of imagePaths) {
    const originalFilename = basename(imagePath);
    const newFilename = `${basename(imagePath, extname(imagePath))}.avif`;

    try {
      // 1. Convert the image to AVIF
      await convertToAvif(imagePath);

      // 2. Find and replace
      const wasReferenced = await findAndReplaceReferences(originalFilename, newFilename);

      if (!wasReferenced) {
        unreferencedImages.push(imagePath);
      }

      // 3. Optional: Delete the original image file
      await unlink(imagePath);
    } catch (_error) {
      /* intentionally empty */
    }
  }
}

processImages().catch((_err) => {
  /* intentionally empty */
});
