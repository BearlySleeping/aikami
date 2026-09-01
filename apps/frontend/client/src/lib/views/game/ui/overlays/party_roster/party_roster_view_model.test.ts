// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/party_roster_view_model.test.ts
//
// Unit tests for PartyRosterViewModel — overlay state, dismiss confirmation,
// and keyboard navigation.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { PartyRosterViewModelInterface } from './party_roster_view_model.svelte';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDismiss = mock(() => true);
const mockClosePartyRoster = mock(() => {});
const mockGetEntityIdForNpc = mock((): number | undefined => undefined);
const mockSendCommand = mock(() => {});

// We use mock.module for $services to override the global mock — every
// service the ViewModel touches (directly or via confirmDismiss's ECS
// sync) must be listed here, since this replaces the whole module.
mock.module('$services', () => ({
  partyRosterService: {
    members: [] as Array<{
      npcId: string;
      name: string;
      classId: string;
      level: number;
      approval: number;
    }>,
    activeCount: 0,
    maxSize: 4,
    formation: 'line',
    isFull: false,
    isEmpty: mock(() => true),
    recruit: mock(() => undefined),
    dismiss: mockDismiss,
    hasMember: mock(() => false),
    getMember: mock(() => undefined),
    getApproval: mock(() => 0),
    adjustApproval: mock(() => {}),
    activatePersonalQuest: mock(() => {}),
    deactivatePersonalQuest: mock(() => {}),
    serialize: mock(() => ({ members: [], maxSize: 4, formation: 'line' })),
    hydrate: mock(() => {}),
    reset: mock(() => {}),
  },
  gameOverlayService: {
    openPartyRoster: mock(() => {}),
    closePartyRoster: mockClosePartyRoster,
    openCharacterDashboard: mock(() => {}),
    openTalkToParty: mock(() => {}),
    clearStack: mock(() => {}),
  },
  gameEngineService: {
    getEntityIdForNpc: mockGetEntityIdForNpc,
    sendCommand: mockSendCommand,
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PartyRosterViewModel', () => {
  let vm: PartyRosterViewModelInterface;

  beforeEach(async () => {
    mockDismiss.mockClear();
    mockClosePartyRoster.mockClear();
    mockGetEntityIdForNpc.mockClear();
    mockSendCommand.mockClear();

    const mod = await import('./party_roster_view_model.svelte');
    vm = mod.getPartyRosterViewModel({ className: 'PartyRosterViewModel' });
  });

  // ── AC-3: Dismiss confirmation ──

  test('requestDismiss shows confirmation dialog', () => {
    vm.requestDismiss({ npcId: 'lydia', name: 'Lydia' });
    expect(vm.showConfirmDismiss).toBe(true);
    expect(vm.confirmDismissNpcId).toBe('lydia');
    expect(vm.confirmDismissName).toBe('Lydia');
  });

  test('confirmDismiss calls dismiss and hides confirmation', () => {
    vm.requestDismiss({ npcId: 'lydia', name: 'Lydia' });
    vm.confirmDismiss();

    expect(mockDismiss).toHaveBeenCalledWith('lydia');
    expect(vm.showConfirmDismiss).toBe(false);
    expect(vm.confirmDismissNpcId).toBe('');
  });

  test('confirmDismiss syncs the ECS Companion.recruited flag when the entity is resolvable', () => {
    mockGetEntityIdForNpc.mockImplementation(() => 42);

    vm.requestDismiss({ npcId: 'lydia', name: 'Lydia' });
    vm.confirmDismiss();

    expect(mockSendCommand).toHaveBeenCalledWith({
      type: 'SET_COMPANION_RECRUITED',
      entityId: 42,
      recruited: false,
    });
  });

  test('cancelDismiss hides confirmation without dismissing', () => {
    vm.requestDismiss({ npcId: 'lydia', name: 'Lydia' });
    vm.cancelDismiss();

    expect(mockDismiss).not.toHaveBeenCalled();
    expect(vm.showConfirmDismiss).toBe(false);
  });

  // ── AC-3: Keyboard navigation ──

  test('handleKeyDown with Escape closes the overlay', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    vm.handleKeyDown(event);
    expect(mockClosePartyRoster).toHaveBeenCalled();
  });

  test('handleDismissKeyDown with Escape cancels dismissal', () => {
    vm.requestDismiss({ npcId: 'lydia', name: 'Lydia' });

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    const preventDefault = mock(() => {});
    const stopPropagation = mock(() => {});
    Object.defineProperty(event, 'preventDefault', { value: preventDefault });
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagation });

    vm.handleDismissKeyDown(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(vm.showConfirmDismiss).toBe(false);
  });

  // ── AC-3: Backdrop click ──

  test('handleBackdropClick closes when clicking backdrop', () => {
    const target = {};
    const event = { target, currentTarget: target } as unknown as MouseEvent;

    vm.handleBackdropClick(event);
    expect(mockClosePartyRoster).toHaveBeenCalled();
  });

  test('handleBackdropClick does not close when clicking child element', () => {
    const backdrop = {};
    const child = {};
    const event = { target: child, currentTarget: backdrop } as unknown as MouseEvent;

    vm.handleBackdropClick(event);
    expect(mockClosePartyRoster).not.toHaveBeenCalled();
  });

  // ── AC-3: Close ──

  test('close calls gameOverlayService.closePartyRoster', () => {
    vm.close();
    expect(mockClosePartyRoster).toHaveBeenCalled();
  });
});
