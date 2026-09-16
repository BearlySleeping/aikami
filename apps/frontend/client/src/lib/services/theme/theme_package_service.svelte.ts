// apps/frontend/client/src/lib/services/theme/theme_package_service.svelte.ts
//
// C-529 AC-3 / AC-6 — the local theme package lifecycle: export, stage, preview,
// commit, cancel.
//
// The lifecycle is deliberately staged, never direct:
//
//   export  → build the envelope from validated token data and download it
//   stage   → unpack, bound and validate; nothing is installed yet
//   commit  → atomically install the staged bytes and select them
//   cancel  → discard the staging area and revoke every object URL it created
//
// 🔴 Two rules this service exists to enforce:
//   1. Nothing activates before the whole package validates. A partially read
//      archive cannot reach the appearance authority.
//   2. Every async import carries an operation id. A slow completion that is no
//      longer the newest request is dropped, so an older read can never replace
//      a newer selection (Directive 12).
//
// Contract: C-529 AC-3, AC-4 (client side), AC-6.

import {
  BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
  BUILTIN_THEME_NAME_OBSIDIAN_CHRONICLE,
  BUILTIN_THEME_VERSION,
  THEME_MAX_ARCHIVE_BYTES,
  THEME_MAX_ENTRIES,
  THEME_MAX_EXPANDED_BYTES,
} from '@aikami/constants';
import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services/base';
import {
  buildThemePackage,
  OBSIDIAN_CHRONICLE_DARK,
  OBSIDIAN_CHRONICLE_LIGHT,
  type ThemeArchiveEntry,
  validateThemeArchive,
} from '@aikami/frontend/theme';
import type { ThemeInstallation, ThemeTokenFile } from '@aikami/schemas';
import type { ThemeInstallIntent } from '@aikami/types';
import JSZip from 'jszip';
import { themePackageUrl } from '$lib/utils/theme/theme_install_intent.ts';
import { BlobUrlRegistry, hubApiBase, hubAuthHeaders, sha256Hex } from '$services';
import type {
  StagedTheme,
  ThemeExportOverrides,
  ThemeImportFailure,
  ThemePackageServiceOptions,
} from '$types';
import type {
  ThemeDownloadProgress,
  ThemeHubDownloadOptions,
} from './theme_package_service_types.ts';

export type ThemePackageServiceInterface = BaseFrontendClassInterface & {
  /** The package staged for preview, if any. */
  readonly staged: StagedTheme | undefined;
  readonly isBusy: boolean;
  readonly importFailures: readonly ThemeImportFailure[];
  readonly exportMessage: string | undefined;
  /** Monotonic id of the newest import request — the stale-completion guard. */
  readonly operationId: number;
  /** Progress of the in-flight Hub download, if any (C-530 AC-6). */
  readonly downloadProgress: ThemeDownloadProgress | undefined;

  /** Builds and downloads a package for a built-in theme (duplicate-and-share). */
  exportBuiltInTheme(themeId: string, overrides?: ThemeExportOverrides): Promise<void>;
  /** Unpacks, bounds and validates a picked file. Never installs. */
  stageImport(file: File): Promise<boolean>;
  /**
   * C-530 AC-5/AC-6: downloads one immutable version from the *configured*
   * trusted Hub and stages it. Never installs, never applies.
   */
  stageHubDownload(intent: ThemeInstallIntent, options?: ThemeHubDownloadOptions): Promise<boolean>;
  /** Discards the staging area and revokes its object URLs. */
  cancelStaged(): void;
  /** Hands the staged installation to the caller for an atomic commit. */
  takeStagedForCommit(): ThemeInstallation | undefined;
  dismissMessages(): void;
};

/** Creator-supplied metadata for an export. */
const THEME_API_RANGE = '>=1.0 <2.0';
const DOWNLOAD_MIME = 'application/zip';

/** Header the trusted Hub sets with the promoted package's content address. */
const PACKAGE_DIGEST_HEADER = 'x-aikami-package-sha256';
/** Header the trusted Hub sets with the immutable version it served. */
const PACKAGE_VERSION_HEADER = 'x-aikami-theme-version';

type StreamingZipEntry = JSZip.JSZipObject & {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
};

/** Reads an entry incrementally and stops before it can cross its remaining budget. */
const readBoundedZipEntry = async (options: {
  readonly entry: JSZip.JSZipObject;
  readonly remainingBytes: number;
}): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = (options.entry as StreamingZipEntry).internalStream('uint8array');
    stream
      .on('data', (chunk) => {
        if (settled) {
          return;
        }
        if (total + chunk.byteLength > options.remainingBytes) {
          settled = true;
          stream.pause();
          reject(new Error(`archive expands past ${THEME_MAX_EXPANDED_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
        total += chunk.byteLength;
      })
      .on('error', (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      })
      .on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        const data = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(data);
      })
      .resume();
  });

class ThemePackageService
  extends BaseFrontendClass<ThemePackageServiceOptions>
  implements ThemePackageServiceInterface
{
  staged = $state<StagedTheme | undefined>(undefined);
  isBusy = $state<boolean>(false);
  importFailures = $state<readonly ThemeImportFailure[]>([]);
  exportMessage = $state<string | undefined>(undefined);
  operationId = $state<number>(0);
  /** Progress of the in-flight Hub download, if any (C-530 AC-6). */
  downloadProgress = $state<ThemeDownloadProgress | undefined>(undefined);

  /** Object URLs owned by the staging area. Cleared on cancel and on replace. */
  private readonly _previewUrls = new BlobUrlRegistry();

  /** @inheritdoc */
  async exportBuiltInTheme(themeId: string, overrides: ThemeExportOverrides = {}): Promise<void> {
    if (themeId !== BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE) {
      this.warn('exportBuiltInTheme:unknown', { themeId });
      this.importFailures = [
        {
          code: 'export.unknown-theme',
          message: `No built-in theme "${themeId}".`,
          subject: themeId,
        },
      ];
      return;
    }
    this.isBusy = true;
    try {
      const built = await buildThemePackage(
        {
          id: overrides.id ?? BUILTIN_THEME_ID_OBSIDIAN_CHRONICLE,
          version: overrides.version ?? BUILTIN_THEME_VERSION,
          name: overrides.name ?? BUILTIN_THEME_NAME_OBSIDIAN_CHRONICLE,
          authorDisplayName: overrides.authorDisplayName ?? 'Aikami',
          license: overrides.license ?? 'MIT',
          themeApiRange: THEME_API_RANGE,
          variants: {
            light: OBSIDIAN_CHRONICLE_LIGHT as ThemeTokenFile,
            dark: OBSIDIAN_CHRONICLE_DARK as ThemeTokenFile,
          },
        },
        async (bytes) => sha256Hex(new Blob([new Uint8Array(bytes)])),
      );

      // 🔴 Nothing here reads a preference, a save, a device id or a screenshot:
      // the export is assembled from an allowlist of token data and declared
      // assets, so private data has no path into the archive.
      const zip = new JSZip();
      for (const file of built.files) {
        if (file.bytes !== undefined) {
          zip.file(file.path, file.bytes);
        } else {
          zip.file(file.path, file.text ?? '');
        }
      }
      const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const fileName = `${built.manifest.id}-${built.manifest.version}.aikami-theme.zip`;
      this._download(archive, fileName);
      this.exportMessage = `Exported ${fileName} — ${built.files.length} files, no private data included.`;
      this.importFailures = [];
      this.debug('exportBuiltInTheme', { id: built.manifest.id, files: built.files.length });
    } finally {
      this.isBusy = false;
    }
  }

  /** @inheritdoc */
  async stageImport(file: File): Promise<boolean> {
    // The operation id is taken BEFORE any await, so a slower earlier read can
    // be recognised as stale when it finally resolves.
    this.operationId += 1;
    const operationId = this.operationId;
    this.isBusy = true;
    this.importFailures = [];
    try {
      const entries = await this._readArchive(file);
      return await this._stageEntries(entries, operationId, 'stageImport');
    } catch (error) {
      this._reportUnreadable(error, 'stageImport');
      return false;
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * @inheritdoc
   *
   * 🔴 Two independent checks stand between the network and the staging area:
   * the bytes are bounded *while streaming* (so a hostile response cannot make
   * the client buffer 100 MiB), and the downloaded digest must equal the digest
   * the trusted Hub declared for that immutable version. Only then does the
   * package go through the same local validator a picked file does — a Hub that
   * served something else cannot get it installed.
   *
   * A failure at any step leaves `staged` untouched, so a cancelled or failed
   * update never disturbs the appearance that is currently active.
   */
  async stageHubDownload(
    intent: ThemeInstallIntent,
    options: ThemeHubDownloadOptions = {},
  ): Promise<boolean> {
    this.operationId += 1;
    const operationId = this.operationId;
    this.isBusy = true;
    this.importFailures = [];
    this.downloadProgress = { receivedBytes: 0, totalBytes: 0, cancelled: false };
    try {
      const url = themePackageUrl(intent, hubApiBase());
      let response: Response;
      try {
        response = await fetch(url, {
          headers: hubAuthHeaders(),
          credentials: 'include',
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (error) {
        return this._failDownload(intent, options, error);
      }
      if (!response.ok) {
        this.importFailures = [this._httpFailure(response.status, intent)];
        this.warn('stageHubDownload:http', { status: response.status });
        return false;
      }

      const declaredDigest = response.headers.get(PACKAGE_DIGEST_HEADER);
      const declaredVersion = response.headers.get(PACKAGE_VERSION_HEADER);
      if (declaredVersion === null || declaredVersion !== intent.version) {
        this.importFailures = [
          {
            code: 'hub.version-mismatch',
            message:
              declaredVersion === null
                ? 'The Hub response did not identify the immutable theme version it served.'
                : `The Hub served version ${declaredVersion}, not ${intent.version}.`,
            subject: intent.themeId,
          },
        ];
        return false;
      }
      if (declaredDigest === null) {
        this.importFailures = [
          {
            code: 'package.hash-mismatch',
            message: 'The Hub response did not declare a package digest.',
            subject: intent.themeId,
          },
        ];
        return false;
      }

      const bytes = await this._readBoundedBody(response, intent, options);
      if (bytes === undefined) {
        return false;
      }

      const actual = await sha256Hex(new Blob([new Uint8Array(bytes).buffer]));
      if (actual !== declaredDigest) {
        this.importFailures = [
          {
            code: 'package.hash-mismatch',
            message: 'The downloaded package does not match the digest the Hub declared.',
            subject: intent.themeId,
          },
        ];
        this.warn('stageHubDownload:hash-mismatch', { themeId: intent.themeId });
        return false;
      }

      const entries = await this._readArchiveBytes(bytes);
      return await this._stageEntries(entries, operationId, 'stageHubDownload');
    } catch (error) {
      this._reportUnreadable(error, 'stageHubDownload');
      return false;
    } finally {
      this.isBusy = false;
      this.downloadProgress = undefined;
    }
  }

  /** @inheritdoc */
  cancelStaged(): void {
    this._previewUrls.clear();
    this.staged = undefined;
    this.debug('cancelStaged');
  }

  /** @inheritdoc */
  takeStagedForCommit(): ThemeInstallation | undefined {
    const installation = this.staged?.installation;
    if (installation === undefined) {
      return undefined;
    }
    // The staging area is consumed: the caller now owns the installation and the
    // preview URL is released so nothing leaks.
    this._previewUrls.clear();
    this.staged = undefined;
    return installation;
  }

  /** @inheritdoc */
  dismissMessages(): void {
    this.exportMessage = undefined;
    this.importFailures = [];
  }

  // ── Private ──

  /**
   * Runs the shared staging pipeline over already-extracted entries.
   *
   * Both the picked-file path and the Hub-download path land here, so a package
   * the CLI accepts cannot be rejected by one of them for a structural reason
   * the other ignores — and nothing is activated before the whole package
   * validates.
   */
  private async _stageEntries(
    entries: readonly ThemeArchiveEntry[],
    operationId: number,
    source: string,
  ): Promise<boolean> {
    if (operationId !== this.operationId) {
      this.debug(`${source}:stale`, { operationId, newest: this.operationId });
      return false;
    }

    const validation = validateThemeArchive(entries);
    if (!validation.ok || validation.manifest === undefined) {
      this.importFailures = validation.errors.map((issue) => ({
        code: issue.code,
        message: issue.message,
        subject: issue.subject,
      }));
      this.warn(`${source}:rejected`, { errors: validation.errors.length });
      return false;
    }

    const installation = this._toInstallation(validation.manifest, entries);
    if (installation === undefined) {
      this.importFailures = [
        {
          code: 'package.no-variant',
          message: 'The package declares no usable variant.',
          subject: undefined,
        },
      ];
      return false;
    }

    if (operationId !== this.operationId) {
      return false;
    }

    // Replace the previous staging area — including its object URLs.
    this.cancelStaged();
    const previewBytes = this._entryBytes(entries, validation.manifest.preview);
    const previewUrl =
      previewBytes === undefined
        ? undefined
        : this._previewUrls.register({
            tag: 'theme-preview',
            hash: validation.manifest.preview ?? '',
            blob: new Blob([new Uint8Array(previewBytes)]),
          });

    this.staged = {
      operationId,
      installation,
      previewUrl,
      fileNames: entries
        .filter((entry) => entry.isDirectory !== true)
        .map((entry) => entry.path)
        .sort(),
    };
    this.debug(`${source}:staged`, { id: installation.manifest.id, files: entries.length });
    return true;
  }

  /** Records the one diagnostic a caller sees when bytes are not a package. */
  private _reportUnreadable(error: unknown, source: string): void {
    this.importFailures = [
      {
        code: 'package.unreadable',
        message: 'That file could not be read as a theme package.',
        subject: undefined,
      },
    ];
    this.error(`${source}:failed`, { error: String(error) });
  }

  /**
   * Streams a bounded response body, reporting progress and honouring abort.
   *
   * 🔴 The bound is enforced while reading, not after: a hostile or mistaken
   * response is refused at `THEME_MAX_ARCHIVE_BYTES` instead of being buffered.
   */
  private async _readBoundedBody(
    response: Response,
    intent: ThemeInstallIntent,
    options: ThemeHubDownloadOptions,
  ): Promise<Uint8Array | undefined> {
    const declaredTotal = Number(response.headers.get('content-length'));
    const totalBytes = Number.isFinite(declaredTotal) && declaredTotal > 0 ? declaredTotal : 0;
    if (totalBytes > THEME_MAX_ARCHIVE_BYTES) {
      this.importFailures = [
        {
          code: 'package.too-large',
          message: `That package is ${totalBytes} bytes; the limit is ${THEME_MAX_ARCHIVE_BYTES}.`,
          subject: intent.themeId,
        },
      ];
      return undefined;
    }

    const body = response.body;
    if (body === null) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      return buffer.byteLength > THEME_MAX_ARCHIVE_BYTES ? undefined : buffer;
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        received += value.byteLength;
        if (received > THEME_MAX_ARCHIVE_BYTES) {
          await reader.cancel();
          this.importFailures = [
            {
              code: 'package.too-large',
              message: `That package exceeds ${THEME_MAX_ARCHIVE_BYTES} bytes.`,
              subject: intent.themeId,
            },
          ];
          return undefined;
        }
        chunks.push(value);
        const progress: ThemeDownloadProgress = {
          receivedBytes: received,
          totalBytes,
          cancelled: false,
        };
        this.downloadProgress = progress;
        options.onProgress?.(progress);
      }
    } catch (error) {
      this._failDownload(intent, options, error);
      return undefined;
    } finally {
      reader.releaseLock();
    }

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  /** The one diagnostic a failed or cancelled transfer produces. */
  private _failDownload(
    intent: ThemeInstallIntent,
    options: ThemeHubDownloadOptions,
    error: unknown,
  ): false {
    const cancelled = options.signal?.aborted === true || (error as Error)?.name === 'AbortError';
    if (cancelled) {
      this.downloadProgress = { receivedBytes: 0, totalBytes: 0, cancelled: true };
      this.importFailures = [
        {
          code: 'hub.download-cancelled',
          message: 'The download was cancelled. Your current theme is unchanged.',
          subject: intent.themeId,
        },
      ];
      this.debug('stageHubDownload:cancelled', { themeId: intent.themeId });
      return false;
    }
    this.importFailures = [
      {
        code: 'hub.unreachable',
        message: 'The Hub could not be reached. Your current theme is unchanged.',
        subject: intent.themeId,
      },
    ];
    this.warn('stageHubDownload:failed', { error: String(error) });
    return false;
  }

  /** Maps an HTTP status to an actionable, named failure (AC-12). */
  private _httpFailure(status: number, intent: ThemeInstallIntent): ThemeImportFailure {
    if (status === 404) {
      return {
        code: 'hub.listing-unavailable',
        message:
          'That version is not available from the Hub. It may have been withdrawn; an installed copy keeps working.',
        subject: intent.themeId,
      };
    }
    if (status === 503) {
      return {
        code: 'hub.unavailable',
        message: 'Theme downloads are unavailable in this deployment.',
        subject: intent.themeId,
      };
    }
    return {
      code: 'hub.download-failed',
      message: `The Hub refused the download (${status}).`,
      subject: intent.themeId,
    };
  }

  /** Reads package bytes into bounded archive entries without a filesystem. */
  private async _readArchiveBytes(bytes: Uint8Array): Promise<readonly ThemeArchiveEntry[]> {
    if (bytes.byteLength > THEME_MAX_ARCHIVE_BYTES) {
      throw new Error(`archive exceeds ${THEME_MAX_ARCHIVE_BYTES} bytes (${bytes.byteLength})`);
    }
    return await this._readZipEntries(await JSZip.loadAsync(bytes, { checkCRC32: false }));
  }

  /**
   * Reads a picked file into bounded archive entries.
   *
   * The compressed total is checked against the raw file size BEFORE the archive
   * is parsed, so an oversized file is rejected without paying for decompression.
   */
  private async _readArchive(file: File): Promise<readonly ThemeArchiveEntry[]> {
    if (file.size > THEME_MAX_ARCHIVE_BYTES) {
      throw new Error(`archive exceeds ${THEME_MAX_ARCHIVE_BYTES} bytes (${file.size})`);
    }
    return await this._readZipEntries(
      await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false }),
    );
  }

  /** Walks a loaded ZIP under the entry and expanded-byte budgets. */
  private async _readZipEntries(zip: JSZip): Promise<readonly ThemeArchiveEntry[]> {
    const names = Object.keys(zip.files);
    if (names.length > THEME_MAX_ENTRIES) {
      throw new Error(`archive has ${names.length} entries, limit ${THEME_MAX_ENTRIES}`);
    }

    const entries: ThemeArchiveEntry[] = [];
    let expandedTotal = 0;
    for (const name of names) {
      const zipEntry = zip.files[name];
      if (zipEntry === undefined) {
        continue;
      }
      const unixPermissions = zipEntry.unixPermissions ?? undefined;
      const isSymlink =
        typeof unixPermissions === 'number' && (unixPermissions & 0o170000) === 0o120000;
      if (zipEntry.dir) {
        entries.push({
          path: name,
          compressedBytes: 0,
          expandedBytes: 0,
          isDirectory: true,
        });
        continue;
      }
      const data = await readBoundedZipEntry({
        entry: zipEntry,
        remainingBytes: THEME_MAX_EXPANDED_BYTES - expandedTotal,
      });
      expandedTotal += data.byteLength;
      entries.push({
        path: name,
        // JSZip does not expose a per-entry compressed size, so the entry is
        // charged its expanded size: the container total is then conservative
        // (never under-counted), and the compression-ratio guard is applied by
        // the CLI/directory path where the real ratio is knowable.
        compressedBytes: data.byteLength,
        expandedBytes: data.byteLength,
        isSymlink,
        data,
        sha256: await sha256Hex(new Blob([new Uint8Array(data).buffer])),
      });
    }
    return entries;
  }

  /** Rebuilds the validated token files into an installation record. */
  private _toInstallation(
    manifest: ThemeInstallation['manifest'],
    entries: readonly ThemeArchiveEntry[],
  ): ThemeInstallation | undefined {
    const variants: ThemeInstallation['variants'] = {};
    for (const variant of ['light', 'dark'] as const) {
      const path = manifest.variants[variant];
      if (path === undefined) {
        continue;
      }
      const bytes = this._entryBytes(entries, path);
      if (bytes === undefined) {
        continue;
      }
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as ThemeTokenFile;
      variants[variant] = parsed;
    }
    if (variants.light === undefined && variants.dark === undefined) {
      return undefined;
    }
    return { schemaVersion: 1, manifest, variants };
  }

  private _entryBytes(
    entries: readonly ThemeArchiveEntry[],
    path: string | undefined,
  ): Uint8Array | undefined {
    if (path === undefined) {
      return undefined;
    }
    return entries.find((entry) => entry.path.toLowerCase() === path.toLowerCase())?.data;
  }

  /** Triggers a download without depending on a Hub or any network call. */
  private _download(blob: Blob, fileName: string): void {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return;
    }
    const url = URL.createObjectURL(new Blob([blob], { type: DOWNLOAD_MIME }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

export const themePackageService: ThemePackageServiceInterface = ThemePackageService.create({
  className: 'ThemePackageService',
});
