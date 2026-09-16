// packages/shared/types/src/lib/community/asset_publishing.ts
//
// C-513: community asset publishing types, derived from the TypeBox schemas in
// `@aikami/schemas` (Schema-First law — no hand-written duplicate shapes).
//
// Contract: C-513 End-User Asset Publishing and Community Sharing

export type {
  CommunityAssetCounters,
  CommunityAssetErrorCode,
  CommunityAssetGenerationProjection,
  CommunityAssetModerationState,
  CommunityAssetPage,
  CommunityAssetProvenanceProjection,
  CommunityAssetSummary,
  ModerateCommunityAssetRequest,
  PublishAssetResult,
  ReserveAssetRequest,
  ReserveAssetResult,
  RightsDecision,
  RightsDecisionState,
  RightsScope,
  RightsScopeDecision,
} from '@aikami/schemas';

// C-530: Hub theme publishing and installation shapes, derived from the same
// TypeBox source as every other community wire shape.
export type {
  ModerateThemeVersionRequest,
  ReserveThemeVersionRequest,
  ReserveThemeVersionResult,
  RevokeThemeVersionRequest,
  ThemeAssetFact,
  ThemeInstallIntent,
  ThemePublishErrorCode,
  ThemeVariantFact,
  ThemeVersionDetail,
  ThemeVersionModerationState,
  ThemeVersionPage,
  ThemeVersionSummary,
} from '@aikami/schemas';
