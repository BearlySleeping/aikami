// apps/frontend/client/src/lib/views/chat/choice_buttons_view_model.test.ts
//
// Unit tests for the CYOA choice buttons ViewModel — selection,
// disable-on-select, dismiss, truncation, skill-check badges, and
// single-choice "Continue" behavior.
//
// Contract: C-245 CYOA Choices Branching Narrative

import { describe, expect, it } from 'bun:test';
import { CYOA_SINGLE_CHOICE_LABEL } from '@aikami/constants';
import type { CyoaChoice } from '@aikami/types';
import { ChoiceButtonsViewModel } from './choice_buttons_view_model.svelte.ts';

const createViewModel = (options: {
  choices: CyoaChoice[];
  onSelect?: (choice: CyoaChoice) => void;
}) =>
  ChoiceButtonsViewModel.create({
    className: 'ChoiceButtonsViewModel',
    choices: options.choices,
    onSelect: options.onSelect ?? (() => {}),
  }) as ChoiceButtonsViewModel;

const THREE_CHOICES: CyoaChoice[] = [
  { id: 'c1', label: 'Investigate the ruins' },
  { id: 'c2', label: 'Follow the river trail' },
  { id: 'c3', label: 'Set up camp here' },
];

describe('ChoiceButtonsViewModel', () => {
  it('should render 3 items for 3 choices', () => {
    const vm = createViewModel({ choices: THREE_CHOICES });

    expect(vm.visible).toBe(true);
    expect(vm.items.length).toBe(3);
    expect(vm.items[0].displayLabel).toBe('Investigate the ruins');
  });

  it('should fire onSelect with the full choice and disable buttons', () => {
    let selected: CyoaChoice | undefined;
    const vm = createViewModel({
      choices: THREE_CHOICES,
      onSelect: (choice) => {
        selected = choice;
      },
    });

    vm.selectChoice('c1');

    expect(selected?.label).toBe('Investigate the ruins');
    expect(vm.disabled).toBe(true);
  });

  it('should ignore selection when already disabled', () => {
    let callCount = 0;
    const vm = createViewModel({
      choices: THREE_CHOICES,
      onSelect: () => {
        callCount++;
      },
    });

    vm.selectChoice('c1');
    vm.selectChoice('c2');

    expect(callCount).toBe(1);
  });

  it('should not be visible with zero choices (no-op)', () => {
    const vm = createViewModel({ choices: [] });
    expect(vm.visible).toBe(false);
  });

  it('should render single choice as Continue (prompt-advance)', () => {
    const vm = createViewModel({
      choices: [{ id: 'only', label: 'Press onward into the dark' }],
    });

    expect(vm.items.length).toBe(1);
    expect(vm.items[0].displayLabel).toBe(CYOA_SINGLE_CHOICE_LABEL);
  });

  it('should truncate long labels to 80 chars with ellipsis and keep full text as tooltip', () => {
    const longLabel = 'A'.repeat(120);
    const vm = createViewModel({
      choices: [
        { id: 'long', label: longLabel },
        { id: 'other', label: 'Short' },
      ],
    });

    expect(vm.items[0].displayLabel.length).toBe(81); // 80 + ellipsis
    expect(vm.items[0].displayLabel.endsWith('…')).toBe(true);
    expect(vm.items[0].tooltip).toBe(longLabel);
  });

  it('should format skill check badge text', () => {
    const vm = createViewModel({
      choices: [
        { id: 'c1', label: 'Persuade the guard', skillCheck: { ability: 'Persuasion', dc: 15 } },
        { id: 'c2', label: 'Walk away' },
      ],
    });

    expect(vm.items[0].badgeText).toBe('Persuasion DC 15');
    expect(vm.items[1].badgeText).toBe('');
  });

  it('should hide after dismiss', () => {
    const vm = createViewModel({ choices: THREE_CHOICES });
    vm.dismiss();
    expect(vm.visible).toBe(false);
  });

  it('should re-enable and show on setChoices (branch swipe)', () => {
    const vm = createViewModel({ choices: THREE_CHOICES });
    vm.selectChoice('c1');
    vm.dismiss();

    vm.setChoices([
      { id: 'n1', label: 'New branch choice A' },
      { id: 'n2', label: 'B' },
    ]);

    expect(vm.visible).toBe(true);
    expect(vm.disabled).toBe(false);
    expect(vm.items.length).toBe(2);
  });

  it('should warn and not fire onSelect for unknown choice id', () => {
    let called = false;
    const vm = createViewModel({
      choices: THREE_CHOICES,
      onSelect: () => {
        called = true;
      },
    });

    vm.selectChoice('nonexistent');

    expect(called).toBe(false);
    expect(vm.disabled).toBe(false);
  });
});
