// apps/e2e/src/visual/suites/chat_modes.visual.ts
// Chat Modes Sandbox — declarative visual test suite.
//
// Captures the /dev/chat-modes page to verify the address mode toggle,
// impersonation quick button, and chat UI layout.
//
// Contract: C-241 Chat Modes Address System

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const ChatModesSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  addressModeToggleVisible: Type.Boolean({
    description: 'Whether the Scene/Party/GM address mode toggle buttons are visible',
  }),
  impersonateToggleVisible: Type.Boolean({
    description: 'Whether the 🎭 Impersonate checkbox is visible in chat settings',
  }),
  npcNameVisible: Type.Boolean({
    description: 'Whether the NPC name (Thalia Moonshadow) is visible in the chat header',
  }),
  chatInputVisible: Type.Boolean({
    description: 'Whether the chat text input field is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const CHAT_MODES_PROMPT = [
  'This is a screenshot from the Aikami Chat Modes dev sandbox (/dev/chat-modes).',
  '',
  'EXPECTED:',
  '- A page title "/dev/chat-modes" at the top with three badges: Address Modes, Impersonation, Party Chat.',
  '- An info alert box mentioning a mock persona.',
  '- A chat area with NPC name "Thalia Moonshadow" visible.',
  '- At least 2-3 seed chat messages visible in the message container.',
  '- A text input field at the bottom for typing messages.',
  '- A Send button next to the input.',
  '- Chat settings row with "Streaming TTS" toggle and "🎭 Impersonate" checkbox.',
  '- GM controls at the bottom: Scene/Party/GM address mode toggle buttons and Push Story button.',
  '',
  'EVALUATE:',
  '- Are the address mode toggle buttons (Scene, Party, GM) visible?',
  '- Is the 🎭 Impersonate checkbox visible in the settings?',
  '- Is the NPC name visible?',
  '- Is the chat input field visible?',
  '',
  'Score: 90-100 for all elements present, 70-89 for minor layout issues, 0-69 for missing elements.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'chat-modes',
  route: '/dev/chat-modes',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Chat Modes Sandbox — Full Layout',
      prompt: CHAT_MODES_PROMPT,
      schema: ChatModesSchema,
    },
  ],
});
