// apps/e2e/src/visual/suites/generation_runner.visual.ts
//
// C-522 AC-6: visual evidence for the Hub Studio → Generation review surface.
//
// The suite seeds a real, reviewable state through the *real* API — a paired
// device, a claimed dispatch and a private candidate — then captures the
// surface. A mocked page would prove nothing: the whole point of this surface
// is that a completed job is reviewable, which is exactly what silently broke
// when the runner reported the terminal status before the candidate.
//
// Contract: C-522 Hub and client access to the generation runner

import { localProviderProfileForEngine } from '@aikami/constants';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

/**
 * The provider profile the client studio's portrait recipe resolves to.
 *
 * 🔴 Resolved from the registry, never written down — see the sibling API spec
 * for why: a fixture that copies an id in no registry passes while the real
 * runner refuses every dispatch.
 */
const STUDIO_PROFILE_ID =
  localProviderProfileForEngine({ engineId: 'sdcpp', modality: 'image' })?.id ?? '';
if (STUDIO_PROFILE_ID === '') {
  throw new Error('no local provider profile serves the studio portrait recipe');
}

/** The brief-namespace preparation key the studio and the shipped brief write. */
const STUDIO_PREPARATION_PROFILE = 'portrait';

const HubGenerationRunnerSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual correctness score' }),
  headingVisible: Type.Boolean({ description: 'A "Generation studio" heading is visible' }),
  pairedDeviceListed: Type.Boolean({ description: 'The paired device list shows a device' }),
  dispatchListed: Type.Boolean({ description: 'At least one dispatch is listed with its status' }),
  candidateReviewable: Type.Boolean({
    description: 'A private candidate row with Accept and Reject controls is visible',
  }),
  privateWording: Type.Boolean({
    description:
      'The surface says the result is private/not published, rather than implying publication',
  }),
  noOverflow: Type.Boolean({ description: 'No horizontal overflow or clipped controls' }),
});

const HUB_GENERATION_RUNNER_PROMPT = [
  'This is the Aikami Hub "Studio → Generation" page (the paired-runner review surface).',
  '',
  'EVALUATE:',
  '- Is there a heading reading "Generation studio" with a short explanatory line?',
  '- Is a "Paired devices" section present listing at least one device with a label, platform,',
  '  an online/offline word, and "Preview upload on/off" and "Revoke" buttons?',
  '- Is a "Dispatches" section present listing a job with a status such as "awaiting review"?',
  '- Is a private candidate row shown with "Accept (keeps it private)" and "Reject" buttons?',
  '- Does the page state that accepting keeps the result private (not published)?',
  '- Is the layout clean, with no overlapping, clipped or off-screen controls?',
  '',
  'Score: 90+ for a clean, complete review surface; 70-89 for minor spacing issues;',
  '0-69 for a missing section, a missing candidate row, or a broken layout.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

/** A unique id so repeated runs never collide on a primary key. */
const unique = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const BUDGET = {
  gpuConcurrency: 1,
  candidateLimitPerItem: 1,
  maxCandidatesPerRun: 1,
  hostedBudgetUsd: 0,
  maxDurationSeconds: 0,
  maxPixels: 4_194_304,
  maxRetainedBytes: 33_554_432,
  maxRequestedAudioSecondsPerCandidatePass: 0,
};

export default defineConfig({
  id: 'generation_runner',
  app: 'hub',
  route: '/studio/assets',
  // `hub_ready` polls for the *catalog* grid, which this route never renders.
  waitCondition: 'hub_ready',
  waitSelector: '[data-testid="studio-assets"]',
  requiresAuth: false,
  cases: [
    {
      name: 'Hub review surface with a private candidate',
      searchParams: {},
      // Capture the whole review surface — the status live region alone is a
      // one-line crop that says nothing about whether the section exists.
      screenshotSelector: '[data-testid="studio-assets"]',
      prompt: HUB_GENERATION_RUNNER_PROMPT,
      schema: HubGenerationRunnerSchema,
      requiredTrueFields: [
        'headingVisible',
        'pairedDeviceListed',
        'dispatchListed',
        'candidateReviewable',
        'privateWording',
        'noOverflow',
      ],
      setupHook: async (page) => {
        // 🔴 Absolute URLs: the capture context is created with no `baseURL`, so
        // a relative `page.request.post('/api/...')` fails with "Invalid URL".
        // The page has already navigated to the route, so its origin is the hub.
        const origin = new URL(page.url()).origin;
        const api = page.request;
        const email = `${unique('c522-visual')}@example.com`;
        const password = 'password123';
        // 🔴 Better Auth's CSRF guard answers `403 MISSING_OR_NULL_ORIGIN` for a
        // state-changing request with no `Origin`, and `page.request` sends none
        // by default (a browser would). Without this header the sign-in silently
        // fails and the captured page is the signed-out surface.
        const authHeaders = { origin };
        await api.post(`${origin}/api/auth/sign-up/email`, {
          headers: authHeaders,
          data: { name: 'C-522 Visual', email, password },
        });
        const signIn = await api.post(`${origin}/api/auth/sign-in/email`, {
          headers: authHeaders,
          data: { email, password },
        });
        if (!signIn.ok()) {
          throw new Error(
            `C-522 visual setup: hub sign-in failed (${signIn.status()} ${await signIn.text()})`,
          );
        }

        const codeResponse = await api.post(`${origin}/api/generation/runners/pairing-code`);
        const { code } = (await codeResponse.json()) as { code: string };
        const deviceId = unique('dev_visual');
        const paired = await api.post(`${origin}/api/generation/runners/pair`, {
          data: {
            schemaVersion: 1,
            code,
            deviceId,
            label: 'Studio desktop',
            platform: 'linux',
            modalities: ['image'],
            resourceGroups: ['gpu:0'],
          },
        });
        const { token } = (await paired.json()) as { token: string };

        const created = await api.post(`${origin}/api/generation/dispatches`, {
          data: {
            deviceId,
            jobId: unique('job-visual'),
            requestKey: `visual:${deviceId}`,
            effectiveSpecHash: 'a'.repeat(64),
            spec: {
              itemId: 'visual-item',
              recipeId: 'portrait',
              modality: 'image',
              providerProfileId: STUDIO_PROFILE_ID,
              preparationProfile: STUDIO_PREPARATION_PROFILE,
              referenceIds: [],
              seed: 7,
              candidateLimit: 1,
              budget: BUDGET,
              prompt: 'a visual hero portrait',
            },
          },
        });
        const { dispatchId } = (await created.json()) as { dispatchId: string };

        const auth = { authorization: `Bearer ${token}` };
        const claimed = await api.post(`${origin}/api/generation/runners/claim`, {
          headers: auth,
          data: {
            schemaVersion: 1,
            deviceId,
            resourceGroup: 'gpu:0',
            runnerNow: new Date().toISOString(),
            leaseTtlMs: 300_000,
            modalities: ['image'],
          },
        });
        const claim = (await claimed.json()) as {
          fence: { attempt: number; lease: { leaseId: string } };
        };

        // The shipped order: candidate first, then the terminal status.
        await api.post(`${origin}/api/generation/runners/candidates`, {
          headers: auth,
          data: {
            schemaVersion: 1,
            deviceId,
            dispatchId,
            attempt: claim.fence.attempt,
            leaseId: claim.fence.lease.leaseId,
            candidateId: unique('candidate-visual'),
            preparedHash: 'b'.repeat(64),
            seed: 7,
            provenanceState: 'partial',
            runnerNow: new Date().toISOString(),
          },
        });
        await api.post(`${origin}/api/generation/runners/status`, {
          headers: auth,
          data: {
            schemaVersion: 1,
            deviceId,
            dispatchId,
            attempt: claim.fence.attempt,
            leaseId: claim.fence.lease.leaseId,
            status: 'awaiting_review',
            candidateCount: 1,
            runnerNow: new Date().toISOString(),
          },
        });

        // Reload so the freshly created session cookie is used by the page and
        // the ViewModel hydrates from the seeded state.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByTestId('dispatch-list').waitFor({ timeout: 30_000 });
      },
    },
  ],
});
