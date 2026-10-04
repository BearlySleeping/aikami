// .pi/extensions/lib/image_preparation.ts

import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** Prepare a disposable image copy so lossy optimizers cannot alter evidence. */
export const prepareImageDataUri = async (options: {
  filepath: string;
  signal?: AbortSignal;
  optimizeImage: (filepath: string) => Promise<unknown>;
  encodeImage: (filepath: string) => Promise<string>;
}): Promise<string> => {
  options.signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'aikami-pi-image-'));
  const copyPath = join(directory, basename(options.filepath));
  try {
    await copyFile(options.filepath, copyPath);
    options.signal?.throwIfAborted();
    await options.optimizeImage(copyPath);
    options.signal?.throwIfAborted();
    const dataUri = await options.encodeImage(copyPath);
    options.signal?.throwIfAborted();
    return dataUri;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
