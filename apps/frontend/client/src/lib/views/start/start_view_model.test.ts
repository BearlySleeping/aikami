// apps/frontend/client/src/lib/views/start/start_view_model.test.ts
// Contract: C-317 Rebuild the Start Menu Around Campaigns, Not Personas
// Contract: C-323 AC-3 (start menu routes to setup instead of a dialog)
// Contract: C-345 (pack browser) — wired into startNewGame by C-405
// Contract: C-405 AC-1/AC-2/AC-3 (default path skips world generation)
//
// This suite exercises the ViewModel through feature-owned capability
// fixtures — no global `$services` barrel mock and no dependency on the
// test_preload mock inventory. Each test constructs exactly the capabilities
// it needs.

import { beforeEach, describe, expect, test } from 'bun:test';
import { AiTextProviderRequiredError } from '@aikami/utils';
import { createStartViewModel } from './start_view_model.svelte';
import { createStartHarness, makeCampaign, makePack } from './testing/start_fixtures.ts';

const PACK_EMBERWATCH = makePack();
const PACK_SECOND = makePack({
  id: 'stormreach',
  name: 'Stormreach',
  description: 'A coastal fortress under siege by a rising tide of nightmares.',
  version: '1.0.0',
  updatedAt: '2026-07-20T00:00:00.000Z',
});

describe('StartViewModel (C-317 Campaign-First)', () => {
  let harness: ReturnType<typeof createStartHarness>;

  beforeEach(() => {
    harness = createStartHarness();
  });

  const newViewModel = () =>
    createStartViewModel({ className: 'StartViewModel', ...harness.capabilities });

  // ── AC-1: Continue Shows Only for Resumable Campaigns ────────────────

  describe('AC-1: Continue visibility', () => {
    test('shows Continue when a resumable campaign exists (playing)', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeDefined();
      expect(vm.latestResumableCampaign?.id).toBe('camp-1');
      expect(vm.latestResumableCampaign?.isResumable).toBe(true);
    });

    test('shows Continue when campaign is paused', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'paused' })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign?.isResumable).toBe(true);
    });

    test('shows Continue when campaign is saving', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'saving' })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign?.isResumable).toBe(true);
    });

    test('hides Continue when no campaigns exist', async () => {
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('hides Continue when campaign is in failed state', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'failed' })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('hides Continue when campaign is in creating state', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'creating' })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('hides Continue when campaign is in loading state', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'loading' })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('shows latest resumable campaign when multiple campaigns exist', async () => {
      harness.setCampaigns([
        makeCampaign({ id: 'camp-old', state: 'failed', name: 'Failed Campaign' }),
        makeCampaign({ id: 'camp-resumable', state: 'playing', name: 'Active Campaign' }),
        makeCampaign({ id: 'camp-new', state: 'creating', name: 'New Campaign' }),
      ]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign?.id).toBe('camp-resumable');
    });

    test('continueLatestCampaign loads and routes to /game', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();
      await vm.initialize();

      await vm.continueLatestCampaign();

      expect(harness.routeCalls).toHaveLength(1);
      expect(harness.routeCalls[0].route).toBe('game');
    });

    test('continueLatestCampaign does nothing when no resumable campaign', async () => {
      const vm = newViewModel();
      await vm.initialize();

      await vm.continueLatestCampaign();

      expect(harness.routeCalls).toHaveLength(0);
    });

    test('continueLatestCampaign sets error when loadCampaign throws', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();
      await vm.initialize();

      harness.capabilities.campaign.loadCampaign = async () => {
        throw new Error('Campaign not found');
      };

      await vm.continueLatestCampaign();

      expect(harness.routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBe('Failed to load campaign. Try starting a new adventure.');
    });
  });

  // ── AC-2: New Adventure Always Creates a Fresh Campaign Draft ────────

  describe('AC-2: New Adventure', () => {
    test('creates a fresh campaign and routes to personaCreate', async () => {
      const vm = newViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(harness.routeCalls).toHaveLength(1);
      expect(harness.routeCalls[0].route).toBe('personaCreate');
      expect(harness.routeCalls[0].options?.queryParameters).toEqual({ onboarding: '1' });
    });

    test('routes to setup screen when text provider is missing', async () => {
      const vm = newViewModel();
      await vm.initialize();

      harness.capabilities.campaign.startNewCampaign = async () => {
        throw new AiTextProviderRequiredError('Text provider required');
      };

      await vm.startNewAdventure();

      expect(harness.routeCalls).toHaveLength(1);
      expect(harness.routeCalls[0].route).toBe('setup');
      expect(harness.routeCalls[0].options?.queryParameters).toEqual({
        reason: 'text-provider-required',
      });
    });

    test('routes directly when no campaigns exist', async () => {
      const vm = newViewModel();
      await vm.initialize();
      await vm.startNewAdventure();

      expect(harness.routeCalls[0].route).toBe('personaCreate');
    });

    test('shows confirmation when one resumable campaign exists', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();
      await vm.initialize();
      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(true);
      expect(harness.routeCalls).toHaveLength(0);
    });

    test('shows confirmation when three campaigns include a resumable campaign', async () => {
      harness.setCampaigns([
        makeCampaign({ id: 'camp-1', state: 'failed' }),
        makeCampaign({ id: 'camp-2', state: 'playing' }),
        makeCampaign({ id: 'camp-3', state: 'creating' }),
      ]);
      const vm = newViewModel();
      await vm.initialize();
      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(true);
      expect(harness.routeCalls).toHaveLength(0);
    });
  });

  // ── AC-3: Load Campaign Shows All Campaigns as Summary Cards ─────────

  describe('AC-3: Load Campaign', () => {
    test('openLoadCampaign shows the modal', () => {
      const vm = newViewModel();
      vm.openLoadCampaign();

      expect(vm.showLoadCampaign).toBe(true);
    });

    test('closeLoadCampaign hides the modal', () => {
      const vm = newViewModel();
      vm.openLoadCampaign();
      expect(vm.showLoadCampaign).toBe(true);

      vm.closeLoadCampaign();
      expect(vm.showLoadCampaign).toBe(false);
    });

    test('campaignSummaries contains all campaigns sorted newest first', async () => {
      harness.setCampaigns([
        makeCampaign({
          id: 'camp-1',
          name: 'First',
          state: 'playing',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
        makeCampaign({
          id: 'camp-2',
          name: 'Second',
          state: 'failed',
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
        makeCampaign({
          id: 'camp-3',
          name: 'Third',
          state: 'creating',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      ]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries).toHaveLength(3);
      expect(vm.campaignSummaries[0].id).toBe('camp-2');
      expect(vm.campaignSummaries[1].id).toBe('camp-1');
      expect(vm.campaignSummaries[2].id).toBe('camp-3');
    });

    test('campaign summary has correct content pack label', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', contentPackId: 'emberwatch' })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].contentPackLabel).toBe('Emberwatch: The Fading Ward');
    });

    test('campaign summary shows "Not yet saved" when never saved', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', lastSavedAt: undefined })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].lastSavedLabel).toBe('Not yet saved');
    });

    test('campaign summary shows "Not yet saved" for an invalid timestamp', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', lastSavedAt: 'invalid' })]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].lastSavedLabel).toBe('Not yet saved');
    });

    test('campaign summary formats recent save times as relative labels', async () => {
      const now = Date.now();
      harness.setCampaigns([
        makeCampaign({ id: 'just-now', lastSavedAt: new Date(now).toISOString() }),
        makeCampaign({ id: 'minutes', lastSavedAt: new Date(now - 5 * 60000).toISOString() }),
        makeCampaign({ id: 'hours', lastSavedAt: new Date(now - 3 * 3600000).toISOString() }),
        makeCampaign({ id: 'days', lastSavedAt: new Date(now - 2 * 86400000).toISOString() }),
      ]);
      const vm = newViewModel();
      await vm.initialize();

      const labels = Object.fromEntries(
        vm.campaignSummaries.map((campaign) => [campaign.id, campaign.lastSavedLabel]),
      );
      expect(labels['just-now']).toBe('Just now');
      expect(labels.minutes).toBe('5m ago');
      expect(labels.hours).toBe('3h ago');
      expect(labels.days).toBe('2d ago');
    });

    test('campaign summary formats older save times as calendar dates', async () => {
      const now = new Date();
      const lastSavedAt = new Date(now.getFullYear() - 1, 0, 2);
      harness.setCampaigns([
        makeCampaign({ id: 'camp-1', lastSavedAt: lastSavedAt.toISOString() }),
      ]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].lastSavedLabel).toBe(
        lastSavedAt.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      );
    });

    test('campaign summary has correct isResumable for each state', async () => {
      // Deterministic updatedAt: _refreshCampaignState sorts by updatedAt DESC,
      // so relying on Date.now() ties across six objects is a millisecond race.
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      const at = (offsetMs: number): string => new Date(base - offsetMs).toISOString();
      harness.setCampaigns([
        makeCampaign({ id: 'c1', state: 'playing', updatedAt: at(0) }),
        makeCampaign({ id: 'c2', state: 'paused', updatedAt: at(1000) }),
        makeCampaign({ id: 'c3', state: 'saving', updatedAt: at(2000) }),
        makeCampaign({ id: 'c4', state: 'failed', updatedAt: at(3000) }),
        makeCampaign({ id: 'c5', state: 'creating', updatedAt: at(4000) }),
        makeCampaign({ id: 'c6', state: 'loading', updatedAt: at(5000) }),
      ]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].isResumable).toBe(true); // playing
      expect(vm.campaignSummaries[1].isResumable).toBe(true); // paused
      expect(vm.campaignSummaries[2].isResumable).toBe(true); // saving
      expect(vm.campaignSummaries[3].isResumable).toBe(false); // failed
      expect(vm.campaignSummaries[4].isResumable).toBe(false); // creating
      expect(vm.campaignSummaries[5].isResumable).toBe(false); // loading
    });

    test('loadCampaignById loads campaign and routes to /game', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();
      await vm.initialize();

      await vm.loadCampaignById('camp-1');

      expect(harness.routeCalls).toHaveLength(1);
      expect(harness.routeCalls[0].route).toBe('game');
    });

    test('loadCampaignById sets error when campaign not found', async () => {
      const vm = newViewModel();
      await vm.initialize();

      await vm.loadCampaignById('nonexistent');

      expect(harness.routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBe('Failed to load campaign.');
    });

    test('empty campaign list shows no campaigns', async () => {
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries).toHaveLength(0);
    });
  });

  // ── AC-4: Destructive Confirmation Before Overwriting Active Campaign ─

  describe('AC-4: New Adventure confirmation', () => {
    test('shows confirmation dialog when resumable campaign exists', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(true);
      expect(harness.routeCalls).toHaveLength(0);
    });

    test('does NOT show confirmation when no resumable campaigns exist', async () => {
      const vm = newViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(harness.routeCalls).toHaveLength(1);
    });

    test('confirmNewAdventure saves, creates campaign, and routes to personaCreate', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();
      await vm.initialize();

      await vm.startNewAdventure();
      expect(vm.showNewAdventureConfirm).toBe(true);

      await vm.confirmNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(harness.routeCalls).toHaveLength(1);
      expect(harness.routeCalls[0].route).toBe('personaCreate');
      expect(harness.newAdventureCalls).toEqual(['save', 'start']);
    });

    test('cancelNewAdventure hides dialog without routing', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();
      await vm.initialize();

      await vm.startNewAdventure();
      expect(vm.showNewAdventureConfirm).toBe(true);

      vm.cancelNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(harness.routeCalls).toHaveLength(0);
    });
  });

  // ── AC-5: Crash Recovery (C-334, preserved) ─────────────────────────

  describe('AC-5 Crash Recovery (C-334)', () => {
    test('initialize() shows recovery prompt when session marker exists', async () => {
      harness.setSessionMarker('camp-crash-1');
      const vm = newViewModel();

      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(true);
      expect(vm.recoveryCampaignId).toBe('camp-crash-1');
    });

    test('initialize() does not show recovery prompt when no session marker', async () => {
      const vm = newViewModel();

      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(false);
      expect(vm.recoveryCampaignId).toBeUndefined();
    });

    test('acceptRecovery() routes to /game', async () => {
      harness.setSessionMarker('camp-crash-1');
      harness.setAvailableSaves([
        { id: 'auto-save', timestamp: Date.now(), mapName: 'CrashMap', campaignId: 'camp-crash-1' },
      ]);
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(true);
      await vm.acceptRecovery();

      expect(harness.clearSessionMarkerCalls()).toBeGreaterThanOrEqual(1);
      expect(harness.routeCalls).toHaveLength(1);
      expect(harness.routeCalls[0].route).toBe('game');
      expect(vm.showRecoveryPrompt).toBe(false);
    });

    test('declineRecovery() clears session marker silently', async () => {
      harness.setSessionMarker('camp-crash-1');
      const vm = newViewModel();
      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(true);

      await vm.declineRecovery();

      expect(harness.clearSessionMarkerCalls()).toBeGreaterThanOrEqual(1);
      expect(vm.showRecoveryPrompt).toBe(false);
      expect(vm.recoveryCampaignId).toBeUndefined();
    });
  });

  // ── Pack Browser (C-345, preserved) ──────────────────────────────────

  describe('pack browser (C-345)', () => {
    test('openPackBrowser loads packs and shows browser when multiple packs available', async () => {
      harness.setAvailablePacks([PACK_EMBERWATCH, PACK_SECOND]);
      const vm = newViewModel();

      await vm.openPackBrowser();

      expect(vm.showPackBrowser).toBe(true);
      expect(vm.selectedPackId).toBe('emberwatch');
      expect(harness.routeCalls).toHaveLength(0);
    });

    test('openPackBrowser skips browser when only one pack available', async () => {
      harness.setAvailablePacks([PACK_EMBERWATCH]);
      const vm = newViewModel();

      await vm.openPackBrowser();

      expect(vm.showPackBrowser).toBe(false);
      expect(harness.routeCalls).toHaveLength(1);
      expect(harness.routeCalls[0].route).toBe('personaCreate');
    });

    test('closePackBrowser hides the browser and clears selection', async () => {
      harness.setAvailablePacks([PACK_EMBERWATCH, PACK_SECOND]);
      const vm = newViewModel();
      await vm.openPackBrowser();
      expect(vm.showPackBrowser).toBe(true);

      vm.closePackBrowser();

      expect(vm.showPackBrowser).toBe(false);
      expect(vm.selectedPackId).toBeUndefined();
      expect(harness.routeCalls).toHaveLength(0);
    });

    test('selectPack updates selectedPackId', () => {
      const vm = newViewModel();
      vm.selectPack('stormreach');
      expect(vm.selectedPackId).toBe('stormreach');
    });

    test('confirmPackSelection with no selection is a no-op', async () => {
      const vm = newViewModel();
      await vm.confirmPackSelection();
      expect(harness.routeCalls).toHaveLength(0);
    });

    test('startWorldGeneration routes to the worldgen preview', async () => {
      const vm = newViewModel();

      await vm.startWorldGeneration();

      expect(harness.routeCalls).toHaveLength(1);
      expect(harness.routeCalls[0].route).toBe('worldgen');
    });
  });

  // ── initialize() ─────────────────────────────────────────────────────

  describe('initialize()', () => {
    test('sets latestResumableCampaign when campaigns exist', async () => {
      harness.setCampaigns([makeCampaign({ id: 'camp-1', state: 'playing' })]);
      const vm = newViewModel();

      await vm.initialize();

      expect(vm.latestResumableCampaign?.id).toBe('camp-1');
    });

    test('handles empty IndexedDB gracefully', async () => {
      const vm = newViewModel();

      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
      expect(vm.campaignSummaries).toHaveLength(0);
      expect(vm.errorMessage).toBeUndefined();
    });

    test('handles campaign refresh failure gracefully', async () => {
      harness.capabilities.campaign.refreshCampaigns = async () => {
        throw new Error('Storage error');
      };
      const vm = newViewModel();

      await vm.initialize();

      expect(vm.initError).toBe('Error: Storage error');
    });
  });
});
