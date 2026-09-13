// apps/frontend/client/src/lib/services/assets/community_asset_publish.test.ts
//
// C-513 Security/privacy: the publish transport strips container metadata
// before it declares a size.
//
// The assertion that matters is the AC-1 invariant: the `sizeBytes` the client
// reserves must equal the byte length it uploads. Stripping after the reserve
// would desync that check, so the transport is exercised end to end here with
// a fixture that genuinely carries a local path.

import { describe, expect, test } from 'bun:test';
import type {
  CommunityPublishDeps,
  CommunityPublishRequest,
} from './community_asset_capabilities.ts';
import { publishCommunityAsset } from './community_asset_publish.ts';

const POSIX_PATH = '/home/creator/art/hero.png';

/** UTF-8 encodes `text` to a plain byte array (fixture building). */
const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];

/** Latin-1 decodes bytes so a leaked path can be searched for. */
const latin1 = (bytes: Uint8Array): string => {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
};

/** One JPEG marker segment: `FF <marker> <u16 length> <payload>`. */
const jpegSegment = (marker: number, payload: number[]): number[] => {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
};

/** A JPEG whose EXIF (APP1) and COM segments carry the creator's local path. */
const jpegWithExif = (): Uint8Array =>
  Uint8Array.from([
    0xff,
    0xd8,
    ...jpegSegment(0xe0, [
      ...ascii('JFIF\0'),
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
    ]),
    ...jpegSegment(0xe1, [...ascii('Exif\0\0'), ...ascii(POSIX_PATH)]),
    ...jpegSegment(0xfe, ascii(POSIX_PATH)),
    ...jpegSegment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    0x00,
    0x01,
    0x02,
    0xff,
    0xd9,
  ]);

const publishRequest = (
  overrides: Partial<CommunityPublishRequest> = {},
): CommunityPublishRequest => ({
  tag: 'props:community:hero',
  category: 'props',
  title: 'Hero',
  ext: '.jpg',
  provenance: { source: 'original', license: 'CC-BY-4.0' },
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Captures the reserve body and the uploaded bytes. */
const createDeps = () => {
  const captured: {
    reserveBody?: Record<string, unknown>;
    uploadedBytes?: Uint8Array;
  } = {};

  const deps: CommunityPublishDeps = {
    hubBaseUrl: 'https://hub.bearlysing.test/api/',
    authHeaders: () => ({ cookie: 'session=1' }),
    fetchImpl: async (_input, init) => {
      if (init?.method === 'PUT') {
        captured.uploadedBytes = init.body as Uint8Array;
        return jsonResponse({
          slug: 'hero',
          revision: 1,
          sha256: 'a'.repeat(64),
          moderationState: 'pending',
          deliveryUrl: '/api/assets/community/hero/raw',
        });
      }
      captured.reserveBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(
        {
          slug: 'hero',
          revision: 1,
          uploadPath: '/assets/community/hero/upload',
          stagingState: 'reserved',
        },
        201,
      );
    },
  };

  return { deps, captured };
};

describe('C-513 publish transport — metadata is stripped before the size is declared', () => {
  test('the local path never reaches the reserve body or the uploaded bytes', async () => {
    const { deps, captured } = createDeps();
    const input = jpegWithExif();

    const outcome = await publishCommunityAsset(deps, publishRequest(), input);

    expect(outcome.published).toBe(true);
    expect(captured.uploadedBytes).toBeDefined();
    const uploaded = captured.uploadedBytes as Uint8Array;

    // EXIF and COM are gone from the wire.
    expect(latin1(uploaded)).not.toContain(POSIX_PATH);
    expect(uploaded.byteLength).toBeLessThan(input.length);

    // The JFIF header and the scan data survive — it is still a JPEG.
    expect(latin1(uploaded)).toContain('JFIF');
    expect(latin1(uploaded).slice(0, 2)).toBe('\u00ff\u00d8');
  });

  test('AC-1: the declared sizeBytes equals the uploaded byte length', async () => {
    const { deps, captured } = createDeps();
    const input = jpegWithExif();

    await publishCommunityAsset(deps, publishRequest(), input);

    const uploaded = captured.uploadedBytes as Uint8Array;
    expect(captured.reserveBody?.sizeBytes).toBe(uploaded.byteLength);
    // …and it is the STRIPPED length, not the caller's original.
    expect(captured.reserveBody?.sizeBytes).toBeLessThan(input.length);
  });

  test('bytes with no metadata are uploaded unchanged', async () => {
    const { deps, captured } = createDeps();
    const plain = new TextEncoder().encode('plain-generated-asset-bytes');

    const outcome = await publishCommunityAsset(deps, publishRequest(), plain);

    expect(outcome.published).toBe(true);
    const uploaded = captured.uploadedBytes as Uint8Array;
    expect(uploaded.byteLength).toBe(plain.byteLength);
    expect(captured.reserveBody?.sizeBytes).toBe(plain.byteLength);
  });

  test('an empty payload is refused before any network call', async () => {
    const { deps, captured } = createDeps();
    const outcome = await publishCommunityAsset(deps, publishRequest(), new Uint8Array(0));

    expect(outcome.published).toBe(false);
    if (!outcome.published) {
      expect(outcome.reason).toBe('empty_asset');
    }
    expect(captured.reserveBody).toBeUndefined();
  });

  test('the hub base keeps a single slash when the transport builds URLs', async () => {
    const urls: string[] = [];
    const { deps } = createDeps();
    const outcome = await publishCommunityAsset(
      {
        ...deps,
        fetchImpl: async (input, init) => {
          urls.push(String(input));
          if (init?.method === 'PUT') {
            return jsonResponse({
              slug: 'hero',
              revision: 1,
              sha256: 'a'.repeat(64),
              moderationState: 'pending',
              deliveryUrl: '/api/assets/community/hero/raw',
            });
          }
          return jsonResponse(
            {
              slug: 'hero',
              revision: 1,
              uploadPath: '/assets/community/hero/upload',
              stagingState: 'reserved',
            },
            201,
          );
        },
      },
      publishRequest(),
      new TextEncoder().encode('bytes'),
    );

    expect(outcome.published).toBe(true);
    expect(urls[0]).toBe('https://hub.bearlysing.test/api/assets/community');
    expect(urls[1]).toBe('https://hub.bearlysing.test/api/assets/community/hero/upload');
  });
});
