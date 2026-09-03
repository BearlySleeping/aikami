// apps/frontend/client/src/lib/services/config/config_migration.ts
//
// Pure migration function: v1 vault payload → v2 vault payload (C-463).
// No service dependency — unit-testable without configService.
//
// Migration rules:
// 1. Group v1 connections by (provider, baseUrl ?? '', apiKey ?? '').
//    Each distinct triple becomes one AiProvider. Two rows with the same
//    provider id but different keys are two accounts and must NOT be merged.
// 2. Every v1 connection becomes one AiConnection pointing at its group's
//    provider, carrying model and its params.
// 3. Seed roles from defaultByCapability — the text default fills all text
//    roles, the image default fills image roles, the voice default fills
//    voice roles. Fall back to first connection of that capability.
// 4. Carry source from v1 connection onto the provider. Where rows in one
//    group disagree, prefer 'stored' > 'env' > 'detected'.
// 5. Move standalone voiceApiKey / imageApiKey onto matching provider, or
//    into a new provider if none matches.
// 6. Convert each models[] row into a text AiConnection. Skip rows whose
//    (provider, model) pair is already covered by a migrated connection.
//
// Contract: C-463

import type {
  AiConnection,
  AiProvider,
  AiRole,
  ConnectionCapability,
  ProviderSource,
  RoleAssignments,
  V1Connection,
  V1VaultPayload,
  VaultPayloadV2,
} from '@aikami/types';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_VOICE_OPTIONS } from '$lib/data/connection_defaults.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for migrateVaultV1ToV2. */
export type MigrationOptions = {
  /** ID factory for deterministic testing. Defaults to crypto.randomUUID. */
  idFactory?: () => string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_PREFERENCE: Record<string, number> = { stored: 3, env: 2, detected: 1 };

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Migrates a v1 vault payload to the v2 shape.
 *
 * This is a PURE function — given the same v1 payload and id factory, it
 * always produces the same v2 payload. No side effects, no service access.
 *
 * Throws if the payload is fundamentally malformed (e.g. connections is not
 * an array). Callers must catch and fall back to empty state.
 */
export const migrateVaultV1ToV2 = (
  v1: V1VaultPayload,
  options?: MigrationOptions,
): VaultPayloadV2 => {
  const idFactory = options?.idFactory ?? crypto.randomUUID.bind(crypto);
  const v1Connections = v1.connections ?? [];

  // Validate that connections is an array
  if (!Array.isArray(v1Connections)) {
    throw new Error('Migration failed: v1 connections is not an array');
  }

  // ── Step 1: Group v1 connections by (provider, baseUrl, apiKey) ────────
  // Each distinct triple becomes one AiProvider.
  const groupKey = (conn: V1Connection): string => {
    const baseUrl = conn.baseUrl ?? '';
    const apiKey = conn.apiKey ?? '';
    return `${conn.provider}::${baseUrl}::${apiKey}`;
  };

  const groups = new Map<string, V1Connection[]>();
  for (const conn of v1Connections) {
    const key = groupKey(conn);
    const existing = groups.get(key) ?? [];
    existing.push(conn);
    groups.set(key, existing);
  }

  // ── Step 2: Create providers from groups ──────────────────────────────
  const providerIdByGroupKey = new Map<string, string>();
  const providers: AiProvider[] = [];

  for (const [key, group] of groups) {
    const firstConn = group[0];
    const providerId = idFactory();
    providerIdByGroupKey.set(key, providerId);

    // Resolve source: prefer stored > env > detected
    const sourcePriority = (s: string | undefined): number => SOURCE_PREFERENCE[s ?? ''] ?? 0;
    const bestSource = group
      .map((c) => c.source)
      .filter((s): s is string => s !== undefined)
      .sort((a, b) => sourcePriority(b) - sourcePriority(a))[0];

    providers.push({
      id: providerId,
      registryId: firstConn.provider,
      label: firstConn.name,
      credential: firstConn.apiKey || undefined,
      baseUrl: firstConn.baseUrl || undefined,
      source: (bestSource ?? 'stored') as ProviderSource,
    });
  }

  // ── Step 3: Create connections from each v1 connection ────────────────
  const connections: AiConnection[] = [];

  for (const conn of v1Connections) {
    const key = groupKey(conn);
    const providerId = providerIdByGroupKey.get(key);
    if (!providerId) {
      // This shouldn't happen since we built groups from all connections
      continue;
    }

    const capability = (conn.capability ?? 'text') as ConnectionCapability;

    let params: AiConnection['params'];
    if (capability === 'image') {
      const imageOptions = conn.imageOptions ?? DEFAULT_IMAGE_OPTIONS;
      params = {
        checkpoint: imageOptions.checkpoint,
        width: imageOptions.width,
        height: imageOptions.height,
        steps: imageOptions.steps,
        cfg: imageOptions.cfg,
      };
    } else if (capability === 'voice') {
      const voiceOptions = conn.voiceOptions ?? DEFAULT_VOICE_OPTIONS;
      params = {
        voiceId: voiceOptions.voiceId,
        speed: voiceOptions.speed,
        pitch: voiceOptions.pitch,
      };
    } else {
      params = { ...conn.generationParams };
    }

    connections.push({
      id: conn.id,
      providerId,
      capability,
      label: conn.name,
      model: conn.model,
      params,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    });
  }

  // ── Step 4: Seed roles from defaultByCapability ───────────────────────
  const roles: RoleAssignments = {};
  const defaultByCapability = v1.defaultByCapability ?? {};

  // Text roles
  const textDefaultId = defaultByCapability.text ?? v1.defaultConnectionId ?? undefined;
  if (
    textDefaultId &&
    connections.some(
      (connection) => connection.id === textDefaultId && connection.capability === 'text',
    )
  ) {
    const textRoles: AiRole[] = ['narration', 'dialogue', 'summarization', 'structured'];
    for (const role of textRoles) {
      roles[role] = textDefaultId;
    }
  }

  // Image roles
  const imageDefaultId = defaultByCapability.image ?? undefined;
  if (
    imageDefaultId &&
    connections.some(
      (connection) => connection.id === imageDefaultId && connection.capability === 'image',
    )
  ) {
    const imageRoles: AiRole[] = ['portrait', 'scene'];
    for (const role of imageRoles) {
      roles[role] = imageDefaultId;
    }
  }

  // Voice roles
  const voiceDefaultId = defaultByCapability.voice ?? undefined;
  if (
    voiceDefaultId &&
    connections.some(
      (connection) => connection.id === voiceDefaultId && connection.capability === 'voice',
    )
  ) {
    const voiceRoles: AiRole[] = ['narrator-voice', 'npc-voice'];
    for (const role of voiceRoles) {
      roles[role] = voiceDefaultId;
    }
  }

  // Fallback: if a capability default is missing but a connection exists,
  // use the first connection of that capability
  const hasTextRole = roles.narration !== undefined;
  const hasImageRole = roles.portrait !== undefined;
  const hasVoiceRole = roles['narrator-voice'] !== undefined;

  if (!hasTextRole) {
    const firstText = v1Connections.find((c) => (c.capability ?? 'text') === 'text');
    if (firstText) {
      const textRoles: AiRole[] = ['narration', 'dialogue', 'summarization', 'structured'];
      for (const role of textRoles) {
        roles[role] = firstText.id;
      }
    }
  }

  if (!hasImageRole) {
    const firstImage = v1Connections.find((c) => c.capability === 'image');
    if (firstImage) {
      const imageRoles: AiRole[] = ['portrait', 'scene'];
      for (const role of imageRoles) {
        roles[role] = firstImage.id;
      }
    }
  }

  if (!hasVoiceRole) {
    const firstVoice = v1Connections.find((c) => c.capability === 'voice');
    if (firstVoice) {
      const voiceRoles: AiRole[] = ['narrator-voice', 'npc-voice'];
      for (const role of voiceRoles) {
        roles[role] = firstVoice.id;
      }
    }
  }

  // ── Step 5: Move standalone voiceApiKey / imageApiKey ─────────────────
  // These were added in PR #235. If a matching voice/image provider already
  // exists, set its credential. Otherwise, create a new provider.
  const voiceApiKey = v1.voiceApiKey;
  if (voiceApiKey) {
    const voiceConn = v1Connections.find((c) => c.capability === 'voice');
    if (voiceConn) {
      const key = groupKey(voiceConn);
      const providerId = providerIdByGroupKey.get(key);
      if (providerId) {
        const provider = providers.find((p) => p.id === providerId);
        if (provider && !provider.credential) {
          provider.credential = voiceApiKey;
        }
      }
    } else {
      // Create a new provider for the standalone voice key
      const providerId = idFactory();
      providers.push({
        id: providerId,
        registryId: 'elevenlabs',
        label: 'ElevenLabs (legacy)',
        credential: voiceApiKey,
        source: 'stored',
      });
    }
  }

  const imageApiKey = v1.imageApiKey;
  if (imageApiKey) {
    const imageConn = v1Connections.find((c) => c.capability === 'image');
    if (imageConn) {
      const key = groupKey(imageConn);
      const providerId = providerIdByGroupKey.get(key);
      if (providerId) {
        const provider = providers.find((p) => p.id === providerId);
        if (provider && !provider.credential) {
          provider.credential = imageApiKey;
        }
      }
    } else {
      const providerId = idFactory();
      providers.push({
        id: providerId,
        registryId: 'novelai',
        label: 'Image (legacy)',
        credential: imageApiKey,
        source: 'stored',
      });
    }
  }

  // ── Step 6: Convert models[] rows into text AiConnections ─────────────
  const models = (v1 as Record<string, unknown>).models;
  if (Array.isArray(models)) {
    const existingPairs = new Set(
      connections
        .filter((c) => c.capability === 'text')
        .map((c) => {
          const connProvider = providers.find((p) => p.id === c.providerId);
          return `${c.model}::${connProvider?.registryId ?? ''}`;
        }),
    );

    for (const modelRow of models) {
      if (
        typeof modelRow !== 'object' ||
        modelRow === null ||
        typeof (modelRow as Record<string, unknown>).model !== 'string'
      ) {
        continue;
      }
      const row = modelRow as { model: string; provider: string; endpoint?: string };

      // Skip if a migrated connection already covers this (provider, model) pair
      const pairKey = `${row.model}::${row.provider}`;
      if (existingPairs.has(pairKey)) {
        continue;
      }

      // Find or create provider for this model row
      const modelBaseUrl = row.endpoint ?? '';
      const modelKey = `${row.provider}::${modelBaseUrl}::`;
      let modelProviderId = providerIdByGroupKey.get(modelKey);

      if (!modelProviderId) {
        const keyedMatches = providers.filter(
          (provider) =>
            provider.registryId === row.provider &&
            (provider.baseUrl ?? '') === modelBaseUrl &&
            Boolean(provider.credential),
        );
        if (keyedMatches.length === 1) {
          modelProviderId = keyedMatches[0].id;
        }
      }

      if (!modelProviderId) {
        modelProviderId = idFactory();
        providerIdByGroupKey.set(modelKey, modelProviderId);
        providers.push({
          id: modelProviderId,
          registryId: row.provider,
          label: row.provider,
          source: 'stored',
          baseUrl: modelBaseUrl || undefined,
        });
      }

      const connId = idFactory();
      connections.push({
        id: connId,
        providerId: modelProviderId,
        capability: 'text',
        label: row.model,
        model: row.model,
        params: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          repetitionPenalty: 1.1,
          presencePenalty: 0,
          maxTokens: 1024,
          contextSize: 4096,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // ── Assemble v2 payload ──────────────────────────────────────────────
  const v2: VaultPayloadV2 = {
    schemaVersion: 2,
    providers,
    connections,
    roles,
    userPresets: v1.userPresets ?? [],
    legacy: v1,
  };

  return v2;
};
