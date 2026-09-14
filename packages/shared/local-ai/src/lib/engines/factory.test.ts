// packages/shared/local-ai/src/lib/engines/factory.test.ts
// biome-ignore-all lint/style/useNamingConvention: ACE-Step v1.5 uses snake_case wire fields
//
// C-521 AC-1: the factory must dispatch a profile's DECLARED protocol to the
// matching adapter. Before this, `createGenerationEngine('ace-step', …)`
// always returned the v1 adapter, so the declared default music profile
// (`ace_step_15_2b_turbo_profile`, protocol `ace-step-v1.5`) was routed at the
// v1 `/generate` API — the exact "pretending it is the v1 API" failure the
// architecture directives forbid.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { describe, expect, test } from 'bun:test';
import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import { AceStepGenerationEngine } from './ace_step_engine.ts';
import { AceStepV15GenerationEngine } from './ace_step_v15_engine.ts';
import {
  ACE_STEP_PROTOCOLS,
  createGenerationEngine,
  DEFAULT_ACE_STEP_PROTOCOL,
  isAceStepProtocol,
} from './factory.ts';

const BASE_URL = 'http://127.0.0.1:8091';

describe('createGenerationEngine — ACE-Step protocol selection', () => {
  test('a v1.5 profile constructs the versioned adapter', () => {
    const engine = createGenerationEngine('ace-step', {
      baseUrl: BASE_URL,
      aceStepProtocol: 'ace-step-v1.5',
      aceStepV15: { modelId: 'audio-ace-step-v15-2b-turbo' },
    });
    expect(engine).toBeInstanceOf(AceStepV15GenerationEngine);
    expect((engine as AceStepV15GenerationEngine).modelId).toBe('audio-ace-step-v15-2b-turbo');
    // The versioned adapter reports real progress; the v1 one cannot.
    expect(engine.capabilities.progress).toBe(true);
  });

  test('a v1 profile still constructs the v1 adapter', () => {
    const engine = createGenerationEngine('ace-step', {
      baseUrl: BASE_URL,
      aceStepProtocol: 'ace-step-v1',
    });
    expect(engine).toBeInstanceOf(AceStepGenerationEngine);
    expect(engine.capabilities.progress).toBe(false);
  });

  test('an unnamed protocol keeps the shipped v1 default (no silent upgrade)', () => {
    expect(DEFAULT_ACE_STEP_PROTOCOL).toBe('ace-step-v1');
    const engine = createGenerationEngine('ace-step', { baseUrl: BASE_URL });
    expect(engine).toBeInstanceOf(AceStepGenerationEngine);
  });

  test('the factory resolves the protocol the declared profiles actually carry', () => {
    // The declared default music profile is v1.5 — this is the assignment that
    // used to arrive at the v1 adapter.
    const musicProfile = GENERATION_PROVIDER_PROFILES.ace_step_15_2b_turbo_profile;
    expect(musicProfile?.protocol).toBe('ace-step-v1.5');
    expect(isAceStepProtocol(musicProfile?.protocol)).toBe(true);
    expect(musicProfile?.modelId).toBe('audio-ace-step-v15-2b-turbo');

    const engine = createGenerationEngine('ace-step', {
      baseUrl: BASE_URL,
      aceStepProtocol: musicProfile?.protocol,
      aceStepV15: { modelId: musicProfile?.modelId },
    });
    expect(engine).toBeInstanceOf(AceStepV15GenerationEngine);
    expect((engine as AceStepV15GenerationEngine).modelId).toBe(musicProfile?.modelId);

    // And the rollback profile lands on the v1 adapter.
    const rollback = GENERATION_PROVIDER_PROFILES.ace_step_v1_3_5b_profile;
    expect(isAceStepProtocol(rollback?.protocol)).toBe(true);
    const rollbackEngine = createGenerationEngine('ace-step', {
      baseUrl: BASE_URL,
      aceStepProtocol: rollback?.protocol,
      aceStep: { modelId: rollback?.modelId },
    });
    expect(rollbackEngine).toBeInstanceOf(AceStepGenerationEngine);
  });

  test('the transport is not dialled until a request is made', async () => {
    // Constructing the v1.5 adapter must not probe or dial anything — the
    // CLI builds one engine per item, including for items it later blocks.
    const engine = createGenerationEngine('ace-step', {
      baseUrl: 'http://127.0.0.1:1',
      aceStepProtocol: 'ace-step-v1.5',
    });
    expect(engine.modality).toBe('audio');
    expect(engine.capabilities.cancel).toBe(false);
  });
});

describe('protocol vocabulary', () => {
  test('declares exactly the two protocols the profiles use', () => {
    expect([...ACE_STEP_PROTOCOLS]).toEqual(['ace-step-v1', 'ace-step-v1.5']);
  });

  test('rejects anything else', () => {
    expect(isAceStepProtocol('ace-step-v2')).toBe(false);
    expect(isAceStepProtocol(undefined)).toBe(false);
  });
});
