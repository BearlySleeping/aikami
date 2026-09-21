// apps/frontend/client/src/lib/services/assets/blob_url_registry.ts

type BlobUrlEntry = {
  tag: string;
  hash: string;
  url: string;
  refs: number;
};

/** Owns current and superseded object URLs until their exact references drain. */
export class BlobUrlRegistry {
  private readonly _currentByTag = new Map<string, BlobUrlEntry>();
  private readonly _entriesByUrl = new Map<string, BlobUrlEntry>();

  /** Returns the current URL without acquiring it. */
  peek(tag: string): string | null {
    return this._currentByTag.get(tag)?.url ?? null;
  }

  /** Whether a tag currently has a URL entry. */
  has(tag: string): boolean {
    return this._currentByTag.has(tag);
  }

  /** Acquires the current URL for a tag. */
  acquire(tag: string): string | null {
    const entry = this._currentByTag.get(tag);
    if (!entry) {
      return null;
    }
    entry.refs += 1;
    return entry.url;
  }

  /** Acquires an exact URL returned by an asynchronous resolve. */
  retain(url: string): void {
    const entry = this._entriesByUrl.get(url);
    if (entry) {
      entry.refs += 1;
    }
  }

  /** Publishes a URL for a hash while preserving referenced superseded URLs. */
  register(options: { tag: string; hash: string; blob: Blob }): string {
    const existing = this._currentByTag.get(options.tag);
    if (existing?.hash === options.hash) {
      return existing.url;
    }

    const url = createObjectUrl(options.blob);
    const entry: BlobUrlEntry = { tag: options.tag, hash: options.hash, url, refs: 0 };
    this._currentByTag.set(options.tag, entry);
    this._entriesByUrl.set(url, entry);
    if (existing && existing.refs <= 0) {
      this._discard(existing);
    }
    return url;
  }

  /** Releases the current URL associated with a legacy tag-based caller. */
  releaseTag(tag: string): void {
    const entry = this._currentByTag.get(tag);
    if (entry) {
      this._release(entry);
    }
  }

  /** Releases the exact URL acquired by a consumer. */
  releaseUrl(url: string): void {
    const entry = this._entriesByUrl.get(url);
    if (entry) {
      this._release(entry);
    }
  }

  /** Revokes every current and superseded URL. */
  clear(): void {
    for (const entry of this._entriesByUrl.values()) {
      revokeObjectUrl(entry.url);
    }
    this._currentByTag.clear();
    this._entriesByUrl.clear();
  }

  private _release(entry: BlobUrlEntry): void {
    entry.refs -= 1;
    if (entry.refs <= 0) {
      this._discard(entry);
    }
  }

  private _discard(entry: BlobUrlEntry): void {
    if (this._currentByTag.get(entry.tag) === entry) {
      this._currentByTag.delete(entry.tag);
    }
    this._entriesByUrl.delete(entry.url);
    revokeObjectUrl(entry.url);
  }
}

let mockObjectUrlSequence = 0;

/** Creates an object URL, with unique test-environment fallbacks. */
const createObjectUrl = (blob: Blob): string => {
  if (typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(blob);
  }
  mockObjectUrlSequence += 1;
  return `blob:mock-${blob.size}-${mockObjectUrlSequence}`;
};

/** Revokes object URLs when the host provides the browser API. */
const revokeObjectUrl = (url: string): void => {
  if (url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
};
