// apps/backend/image/scripts/generate_batch_hosted.ts
/** biome-ignore-all lint/style/useNamingConvention: environment variable names follow the platform convention (AIKAMI_HOSTED_ADAPTERS), not camelCase */
//
// C-524: the `generate:batch` CLI's hosted-transport seam.
//
// Two things live here, and they are deliberately separate:
//
//   * `hostedEnvFor` builds the environment the hosted layer resolves its
//     adapter flag and credential from. The credential is *read* from the
//     process environment and never echoed, written to a brief, a run lock, a
//     job record or the plan output.
//   * `hostedFixtureTransportFromEnv` is a **test seam only** (never documented
//     as a feature, exactly like `AIKAMI_BATCH_TEST_CRASH`). It lets a test
//     drive a real `generate:batch --run` hosted dispatch against the
//     checked-in fixtures — with a transport that counts outbound calls and
//     touches no network — so the production path's reserve/settle behaviour is
//     provable end to end without a paid account.
//
// Contract: C-524 Optional hosted asset provider comparison

import {
  type GenerationHostedOperation,
  type GenerationHostedTransportId,
  isGenerationHostedTransportId,
} from '@aikami/constants';
import {
  createStubHostedTransport,
  ELEVENLABS_SFX_FIXTURE,
  type GenerationStorePaths,
  type HostedOutboundResponse,
  type HostedTransport,
  hostedStorePaths,
  PIXELLAB_IMAGE_FIXTURE,
  toOutboundResponse,
  unsettledReservations,
} from '@aikami/local-stack/generation';
import type { GenerationPlanWarning } from '@aikami/types';
import type { CliOptions } from './generate_batch_options.ts';

/**
 * The environment variable that swaps the real hosted transport for a
 * fixture-backed stub. **Test seam only.**
 *
 * `AIKAMI_HOSTED_TEST_FIXTURE=<transport>[:<operation>]`, e.g.
 * `pixellab:image`. An unrecognised value is ignored, so a stray value in a
 * real environment cannot silently fake a provider response.
 */
export const HOSTED_TEST_FIXTURE_ENV_VAR = 'AIKAMI_HOSTED_TEST_FIXTURE';

/** The recorded fixture for one transport operation, when one exists. */
const fixtureFor = (operation: GenerationHostedOperation): HostedOutboundResponse | undefined => {
  if (operation === 'image') {
    return toOutboundResponse(PIXELLAB_IMAGE_FIXTURE);
  }
  if (operation === 'sfx') {
    return toOutboundResponse(ELEVENLABS_SFX_FIXTURE);
  }
  return undefined;
};

/** Every recorded fixture, keyed by the operation that produces it. */
const FIXTURE_RESPONSES: Readonly<
  Record<string, HostedOutboundResponse | (() => HostedOutboundResponse)>
> = {
  image: () => fixtureFor('image') as HostedOutboundResponse,
  sfx: () => fixtureFor('sfx') as HostedOutboundResponse,
};

/**
 * The effective hosted environment for this invocation.
 *
 * The explicit `--hosted-adapter` flag wins over `AIKAMI_HOSTED_ADAPTERS`; the
 * credential always comes from the process environment and is never a flag
 * (a flag would land in shell history and in the report's own argv echo).
 */
export const hostedEnvFor = (options: {
  hostedAdapters: CliOptions['hostedAdapters'];
  env: Readonly<Record<string, string | undefined>>;
}): Record<string, string | undefined> => ({
  ...options.env,
  ...(options.hostedAdapters.length === 0
    ? {}
    : { AIKAMI_HOSTED_ADAPTERS: options.hostedAdapters.join(',') }),
});

/** The transport a test seam asked for, or `undefined` in a real invocation. */
export const hostedFixtureTransportFromEnv = (env: {
  readonly [key: string]: string | undefined;
}): HostedTransport | undefined => {
  const raw = env[HOSTED_TEST_FIXTURE_ENV_VAR]?.trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const [transportRaw] = raw.split(':');
  if (!isGenerationHostedTransportId(transportRaw)) {
    return undefined;
  }
  const transport: GenerationHostedTransportId = transportRaw;
  return createStubHostedTransport({
    id: `fixture:${transport}`,
    responses: FIXTURE_RESPONSES,
  });
};

/**
 * The warnings an unsettled hosted cost reservation produces for `--status`.
 *
 * 🔴 An unreserved or unresolved spend must stay *auditable*: a rollback may
 * not delete a reservation whose billable outcome is unknown, so the run's own
 * status output names every one of them and the explicit remedy.
 */
export const hostedReservationWarnings = (options: {
  paths: GenerationStorePaths;
}): readonly GenerationPlanWarning[] =>
  unsettledReservations(hostedStorePaths(options.paths)).map((reservation) => ({
    code: 'hosted_reservation_unsettled',
    itemId: reservation.jobId,
    providerProfileId: reservation.providerProfileId,
    message: `Hosted cost reservation ${reservation.reservationId} (job ${reservation.jobId}, ${reservation.estimatedMaxUsd} ${reservation.currency}) is ${reservation.state}: ${reservation.uncertainty ?? 'the provider reported no billable outcome'}. No new attempt is dispatched automatically — resolve it with --reconcile before a new attempt.`,
  }));
