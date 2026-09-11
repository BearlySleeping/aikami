// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/party_roster_view_model.test.ts
//
// Unit tests for PartyRosterViewModel — overlay state, dismiss confirmation,
// and keyboard navigation. Exercises the ViewModel through feature-owned
// fixtures — no global `$services` barrel mock.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createPartyRosterViewModel,
  type PartyRosterEngineCapabilities,
  type PartyRosterOverlayCapabilities,
  type PartyRosterViewModelOptions,
} from './party_roster_view_model.svelte';
import {
  createPartyRoster,
  createPartyRosterEngine,
  createPartyRosterOverlay,
} from './testing/party_roster_fixtures.ts';

const createViewModel = (
  options: {
    roster?: ReturnType<typeof createPartyRoster>;
    engine?: PartyRosterEngineCapabilities;
    overlay?: PartyRosterOverlayCapabilities;
  } = {},
) =>
  createPartyRosterViewModel({
    className: 'PartyRosterViewModel',
    roster: options.roster ?? createPartyRoster(),
    engine:
      options.engine ??
      createPartyRosterEngine({ getEntityIdForNpc: () => undefined, sendCommand: () => {} }),
    overlay: options.overlay ?? createPartyRosterOverlay({ closePartyRoster: () => {} }),
  } satisfies PartyRosterViewModelOptions);

describe('PartyRosterViewModel — dismiss confirmation', () => {
  test('requestDismiss shows the confirmation dialog', () => {
    const viewModel = createViewModel();

    viewModel.requestDismiss({ npcId: 'lydia', name: 'Lydia' });

    expect(viewModel.showConfirmDismiss).toBe(true);
    expect(viewModel.confirmDismissNpcId).toBe('lydia');
    expect(viewModel.confirmDismissName).toBe('Lydia');
  });

  test('confirmDismiss calls dismiss and hides the confirmation', () => {
    const dismiss = mock(() => true);
    const viewModel = createViewModel({ roster: createPartyRoster({ dismiss }) });

    viewModel.requestDismiss({ npcId: 'lydia', name: 'Lydia' });
    viewModel.confirmDismiss();

    expect(dismiss).toHaveBeenCalledWith('lydia');
    expect(viewModel.showConfirmDismiss).toBe(false);
    expect(viewModel.confirmDismissNpcId).toBe('');
  });

  test('confirmDismiss syncs the ECS Companion.recruited flag when resolvable', () => {
    const sendCommand = mock(() => {});
    const viewModel = createViewModel({
      roster: createPartyRoster({ dismiss: () => true }),
      engine: createPartyRosterEngine({ getEntityIdForNpc: () => 42, sendCommand }),
    });

    viewModel.requestDismiss({ npcId: 'lydia', name: 'Lydia' });
    viewModel.confirmDismiss();

    expect(sendCommand).toHaveBeenCalledWith({
      type: 'SET_COMPANION_RECRUITED',
      entityId: 42,
      recruited: false,
    });
  });

  test('confirmDismiss does not sync when the entity cannot be resolved', () => {
    const sendCommand = mock(() => {});
    const viewModel = createViewModel({
      roster: createPartyRoster({ dismiss: () => true }),
      engine: createPartyRosterEngine({ getEntityIdForNpc: () => undefined, sendCommand }),
    });

    viewModel.requestDismiss({ npcId: 'lydia', name: 'Lydia' });
    viewModel.confirmDismiss();

    expect(sendCommand).not.toHaveBeenCalled();
  });

  test('cancelDismiss hides the confirmation without dismissing', () => {
    const dismiss = mock(() => true);
    const viewModel = createViewModel({ roster: createPartyRoster({ dismiss }) });

    viewModel.requestDismiss({ npcId: 'lydia', name: 'Lydia' });
    viewModel.cancelDismiss();

    expect(dismiss).not.toHaveBeenCalled();
    expect(viewModel.showConfirmDismiss).toBe(false);
  });
});

describe('PartyRosterViewModel — keyboard and backdrop', () => {
  test('handleKeyDown with Escape closes the overlay', () => {
    const closePartyRoster = mock(() => {});
    const viewModel = createViewModel({
      overlay: createPartyRosterOverlay({ closePartyRoster }),
    });

    viewModel.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

    expect(closePartyRoster).toHaveBeenCalledTimes(1);
  });

  test('handleDismissKeyDown with Escape cancels dismissal', () => {
    const preventDefault = mock(() => {});
    const stopPropagation = mock(() => {});
    const viewModel = createViewModel();
    viewModel.requestDismiss({ npcId: 'lydia', name: 'Lydia' });

    viewModel.handleDismissKeyDown({
      key: 'Escape',
      preventDefault,
      stopPropagation,
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(viewModel.showConfirmDismiss).toBe(false);
  });

  test('handleBackdropClick closes when clicking the backdrop itself', () => {
    const closePartyRoster = mock(() => {});
    const viewModel = createViewModel({
      overlay: createPartyRosterOverlay({ closePartyRoster }),
    });
    const backdrop = {} as EventTarget;

    viewModel.handleBackdropClick({ target: backdrop, currentTarget: backdrop } as MouseEvent);

    expect(closePartyRoster).toHaveBeenCalledTimes(1);
  });

  test('handleBackdropClick does not close when clicking a child element', () => {
    const closePartyRoster = mock(() => {});
    const viewModel = createViewModel({
      overlay: createPartyRosterOverlay({ closePartyRoster }),
    });

    viewModel.handleBackdropClick({ target: {}, currentTarget: {} } as MouseEvent);

    expect(closePartyRoster).not.toHaveBeenCalled();
  });

  test('close delegates to the overlay capability', () => {
    const closePartyRoster = mock(() => {});
    const viewModel = createViewModel({
      overlay: createPartyRosterOverlay({ closePartyRoster }),
    });

    viewModel.close();

    expect(closePartyRoster).toHaveBeenCalledTimes(1);
  });
});

describe('PartyRosterViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
