// packages/frontend/local-runtime/src/lib/download_integrity.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  atomicPromoteToCache,
  buildResumeRequest,
  enforceFinalSize,
  enforceSizeWhileStreaming,
  extractContentLength,
  extractEtag,
  generateJobId,
  isRangeResponse,
  sha256Hex,
  tempPathForJob,
  verifyChecksum,
} from './download_integrity.ts';

describe('generateJobId', () => {
  test('generates unique job IDs', () => {
    const id1 = generateJobId();
    const id2 = generateJobId();
    expect(id1).not.toBe(id2);
  });

  test('job ID starts with dl-', () => {
    const id = generateJobId();
    expect(id.startsWith('dl-')).toBe(true);
  });
});

describe('tempPathForJob', () => {
  test('generates a temp path with job ID prefix', () => {
    const jobId = generateJobId();
    const tempPath = tempPathForJob(jobId, 'models/text/model.gguf');
    expect(tempPath).toContain(jobId);
    expect(tempPath).toContain('model.gguf');
  });

  test('generates a temp path in the same directory', () => {
    const jobId = generateJobId();
    const tempPath = tempPathForJob(jobId, 'models/text/model.gguf');
    expect(tempPath).toContain('models/text/');
  });

  test('handles paths without directory', () => {
    const jobId = generateJobId();
    const tempPath = tempPathForJob(jobId, 'model.gguf');
    expect(tempPath.startsWith('.')).toBe(true);
    expect(tempPath).toContain(jobId);
  });
});

describe('enforceSizeWhileStreaming', () => {
  test('does not throw when downloaded <= expected', () => {
    expect(() => enforceSizeWhileStreaming(100, 200, 'test.bin')).not.toThrow();
  });

  test('throws when downloaded exceeds expected', () => {
    expect(() => enforceSizeWhileStreaming(300, 200, 'test.bin')).toThrow('exceeded');
  });
});

describe('enforceFinalSize', () => {
  test('returns null when sizes match', () => {
    const result = enforceFinalSize(100, 100, 'test.bin');
    expect(result).toBeNull();
  });

  test('returns failure when sizes mismatch', () => {
    const result = enforceFinalSize(50, 100, 'test.bin');
    expect(result).not.toBeNull();
    if (result && !result.ok) {
      expect(result.reason).toBe('size-mismatch');
    }
  });
});

describe('sha256Hex', () => {
  test('computes SHA-256 of a buffer', async () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('hello world').buffer as ArrayBuffer;
    const hash = await sha256Hex(buffer);
    // Known SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });
});

describe('verifyChecksum', () => {
  test('returns null when checksum matches', async () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('hello world').buffer as ArrayBuffer;
    const hash = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const result = await verifyChecksum(buffer, hash, 'test.bin');
    expect(result).toBeNull();
  });

  test('returns failure when checksum mismatches', async () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('hello world').buffer as ArrayBuffer;
    const result = await verifyChecksum(
      buffer,
      '0000000000000000000000000000000000000000000000000000000000000000',
      'test.bin',
    );
    expect(result).not.toBeNull();
    if (result && !result.ok) {
      expect(result.reason).toBe('checksum-mismatch');
    }
  });
});

describe('atomicPromoteToCache', () => {
  let mockCache: Cache;

  beforeEach(() => {
    const store = new Map<string, Response>();
    mockCache = {
      match: mock((key: RequestInfo | URL) => {
        const keyStr = typeof key === 'string' ? key : key.toString();
        return Promise.resolve(store.get(keyStr) ?? undefined);
      }),
      put: mock((key: RequestInfo | URL, response: Response) => {
        const keyStr = typeof key === 'string' ? key : key.toString();
        store.set(keyStr, response);
        return Promise.resolve();
      }),
      delete: mock((key: RequestInfo | URL) => {
        const keyStr = typeof key === 'string' ? key : key.toString();
        return Promise.resolve(store.delete(keyStr));
      }),
    } as unknown as Cache;
  });

  test('promotes temp key to final key', async () => {
    const data = new Uint8Array([1, 2, 3]);
    await atomicPromoteToCache({
      cache: mockCache,
      tempKey: 'temp-key-1',
      finalKey: 'final-key-1',
      data,
    });

    const finalResponse = await mockCache.match('final-key-1');
    if (!finalResponse) {
      throw new Error('expected final-key-1 to be cached after promotion');
    }
    const finalBytes = await finalResponse.arrayBuffer();
    expect(new Uint8Array(finalBytes)).toEqual(data);
  });

  test('removes temp key after promotion', async () => {
    const data = new Uint8Array([1, 2, 3]);
    await atomicPromoteToCache({
      cache: mockCache,
      tempKey: 'temp-key-2',
      finalKey: 'final-key-2',
      data,
    });

    const tempResponse = await mockCache.match('temp-key-2');
    expect(tempResponse).toBeUndefined();
  });
});

describe('buildResumeRequest', () => {
  test('includes Range header when downloadedBytes > 0', () => {
    const request = buildResumeRequest('https://example.com/file.bin', 500);
    expect(request.headers.get('Range')).toBe('bytes=500-');
  });

  test('does not include Range header when downloadedBytes is 0', () => {
    const request = buildResumeRequest('https://example.com/file.bin', 0);
    expect(request.headers.get('Range')).toBeNull();
  });

  test('includes If-None-Match when etag is provided', () => {
    const request = buildResumeRequest('https://example.com/file.bin', 500, '"abc123"');
    expect(request.headers.get('If-None-Match')).toBe('"abc123"');
  });
});

describe('isRangeResponse', () => {
  test('returns true for 206 status', () => {
    const response = new Response(null, { status: 206 });
    expect(isRangeResponse(response)).toBe(true);
  });

  test('returns false for 200 status', () => {
    const response = new Response(null, { status: 200 });
    expect(isRangeResponse(response)).toBe(false);
  });
});

describe('extractEtag', () => {
  test('extracts ETag from response headers', () => {
    const response = new Response(null, {
      headers: { eTag: '"abc123"' },
    });
    expect(extractEtag(response)).toBe('"abc123"');
  });

  test('returns undefined when no ETag', () => {
    const response = new Response(null);
    expect(extractEtag(response)).toBeUndefined();
  });
});

describe('extractContentLength', () => {
  test('extracts Content-Length', () => {
    const response = new Response(null, {
      headers: { 'Content-Length': '1024' },
    });
    expect(extractContentLength(response)).toBe(1024);
  });

  test('returns 0 when no Content-Length', () => {
    const response = new Response(null);
    expect(extractContentLength(response)).toBe(0);
  });
});
