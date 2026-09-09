// apps/frontend/client/src/lib/components/chat/message_actions.ts
//
// C-490: single source of truth for which message actions are offered, and
// how they are labelled. Pure + unit-testable so the gate can be asserted
// without a DOM.
//
// The gate is BY MODE, not by component: the same action affordance appears
// in chat modes, the dev sandbox, and the campaign dialogue overlay. When
// `disableRewind` is true (consequential campaign play), the
// transcript-rewinding members (branch/edit/delete) are dropped so the world
// is never silently unwound, and retry is honestly labelled "Rephrase".
//
// Contract: C-490 Transcript branching must not imply rewinding the world

import type { MessageAction } from '$types';

export type MessageActionsOptions = {
  /** Message sender — controls which actions are shown. */
  sender: 'user' | 'ai' | 'system';
  /** Whether TTS is available (adds the speak action to AI messages). */
  ttsAvailable?: boolean;
  /**
   * When true (campaign play), transcript-rewinding members are dropped.
   * `copy` always stays; `retry` stays but reads "Rephrase".
   */
  disableRewind?: boolean;
};

/**
 * The ordered list of actions offered for a message given its sender and
 * mode. In campaign play (`disableRewind`) branch/edit/delete are never
 * offered; they remain available in the dev sandbox and non-campaign chat.
 */
export const availableMessageActions = (options: MessageActionsOptions): MessageAction[] => {
  const { sender, ttsAvailable = false, disableRewind = false } = options;

  if (sender === 'ai') {
    const base: MessageAction[] = disableRewind ? ['copy', 'retry'] : ['copy', 'retry', 'branch'];
    return ttsAvailable ? [...base, 'speak'] : base;
  }

  // user (and system) messages
  if (disableRewind) {
    return ['copy'];
  }
  return ['copy', 'edit', 'delete', 'branch'];
};

/** Display label for a message action (retry reads "Rephrase"). */
export const messageActionLabel = (action: MessageAction): string => {
  switch (action) {
    case 'copy':
      return 'Copy';
    case 'retry':
      return 'Rephrase';
    case 'edit':
      return 'Edit';
    case 'delete':
      return 'Delete';
    case 'branch':
      return 'Branch';
    case 'speak':
      return 'Speak';
  }
};

/** Display icon for a message action. */
export const messageActionIcon = (action: MessageAction): string => {
  switch (action) {
    case 'copy':
      return '📋';
    case 'retry':
      return '🔄';
    case 'edit':
      return '✏️';
    case 'delete':
      return '🗑️';
    case 'branch':
      return '🌿';
    case 'speak':
      return '🔊';
  }
};
