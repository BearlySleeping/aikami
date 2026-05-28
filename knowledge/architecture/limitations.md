# Known Limitations & TODOs

Current limitations and future work for the Aikami project.

## Architecture Limitations

1. **No CI/CD pipeline** — No GitHub Actions workflow. All testing and deployment is local.
2. **No staging environment** — Only development (emulator) and production Firebase projects configured.
3. **Pre-existing TS errors in schema tests** — `packages/shared/schemas` test files have 7 TypeScript errors (unused vars, strict null checks). Tests pass at runtime but `tsc --noEmit` fails.
4. **PWA accessibility warnings** — svelte-check reports 7 errors + 9 warnings, mostly a11y violations in chat components.
5. **Firebase config hardcoded** — `.env` template uses placeholder values; no automated Firebase project creation.
6. **No automated dependency updates** — Dependabot/Renovate not configured.

## Feature Gaps

### Planned but Not Implemented
| Feature | Spec | Status |
|---------|------|--------|
| Group Chats | Multiple NPCs in one conversation | Zod schema exists, no UI |
| Character Relationships | Dynamic relationship tracking | Schema exists, no logic |
| Knowledge Graphs | Connected world knowledge | Schema stubbed |
| Lorebook Integration | World lore in chat context | Schema exists, not wired |
| Voice Synthesis (TTS) | ElevenLabs integration | gamejs tests exist, no PWA integration |
| Image Generation | AI avatar creation | Callable function exists, no UI flow |
| NPC Forking | Copy/remix public NPCs | Schema field exists, no UI |
| NPC Expressions | Multiple avatar images per NPC | Schema field exists, no UI |

### Partially Implemented
| Feature | What's done | What's missing |
|---------|------------|----------------|
| Chat | Basic 1-on-1 chat | Streaming, message history, branching |
| Personas | CRUD + switching | Import/export, persona sharing |
| NPCs | CRUD + visibility | Public marketplace, forking, expressions |
| World Building | World schema | World creation UI, world-settings |

## Test Coverage Gaps

- **No PWA unit tests** — ViewModels, services, and components have zero unit test coverage
- **Functions tests minimal** — Only 1 test file covering 5 controllers
- **No visual regression** — Playwright screenshot comparison not configured
- **No performance tests** — No load or stress testing

## Documentation Gaps

- Architecture diagram is a placeholder
- Some package READMEs are stubbed
- API documentation not generated from code
- Firestore security rules documentation minimal

## TODO (High Priority)

1. Fix schema test TypeScript errors
2. Add PWA view model unit tests
3. Set up GitHub Actions CI pipeline
4. Implement group chat UI
5. Wire up lorebook to chat context
6. Complete NPC expressions feature

## TODO (Nice to Have)

1. Visual regression testing setup
2. Automated Firebase project bootstrap in setup script
3. PWA Storybook integration
4. API documentation generation
5. Performance benchmarks
