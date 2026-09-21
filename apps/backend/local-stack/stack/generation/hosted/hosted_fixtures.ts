// apps/backend/local-stack/stack/generation/hosted/hosted_fixtures.ts
//
// C-524: the recorded provider fixtures the adapters are mapped against.
//
// 🔴 These are *documented-shape* fixtures, not captured live responses. Each
// one says so in its own `note`, and `hosted_adapters.test.ts` asserts the
// note is present — so a future reader cannot mistake a hand-written fixture
// for provider evidence. The live smoke (AC-2b) is the only thing that proves
// the wire contract, and it is deliberately never a merge gate.
//
// Contract: C-524 Optional hosted asset provider comparison

import elevenLabsSoundGeneration from './fixtures/elevenlabs_sound_generation.json' with {
  type: 'json',
};
import pixellabCreateImage from './fixtures/pixellab_create_image_pixflux.json' with {
  type: 'json',
};
import type { HostedOutboundResponse } from './hosted_transport.ts';

/** The shape every recorded fixture file carries. */
export type HostedFixtureFile = {
  readonly recordedFrom: string;
  readonly note: string;
  readonly status: number;
  readonly requestId: string;
  readonly contentType?: string;
  readonly json?: unknown;
  readonly bytesBase64?: string;
  readonly metadata: Readonly<Record<string, string>>;
};

/** Turns a fixture file into the transport response it records. */
export const toOutboundResponse = (fixture: HostedFixtureFile): HostedOutboundResponse => ({
  status: fixture.status,
  requestId: fixture.requestId,
  ...(fixture.json === undefined ? {} : { json: fixture.json }),
  ...(fixture.bytesBase64 === undefined
    ? {}
    : { bytes: new Uint8Array(Buffer.from(fixture.bytesBase64, 'base64')) }),
  ...(fixture.contentType === undefined ? {} : { contentType: fixture.contentType }),
  metadata: fixture.metadata,
});

/** The PixelLab `create-image-pixflux` fixture. */
export const PIXELLAB_IMAGE_FIXTURE: HostedFixtureFile = pixellabCreateImage;

/** The ElevenLabs `sound-generation` fixture. */
export const ELEVENLABS_SFX_FIXTURE: HostedFixtureFile = elevenLabsSoundGeneration;
