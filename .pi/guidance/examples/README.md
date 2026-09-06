# Guidance Example Fixtures

Canonical examples referenced by project skills and agent prompts. Each
positive fixture compiles and lints under the relevant project configuration.
Mutation fixtures are intentionally invalid and assert the expected diagnostic.

| File | Status | Purpose |
|------|--------|---------|
| `view_model_canonical.ts` | ✅ executable | Canonical ViewModel factory/export pattern |
| `view_model_mutation.ts` | ❌ intentionally invalid | Prohibited export/instantiation (must fail `guard_mvvm_conventions` M4) |
| `service_canonical.ts` | ✅ executable | Canonical service singleton pattern |
| `helper_canonical.ts` | ✅ executable | Pure helper function, no class scaffolding |
| `data_boundary_canonical.ts` | ✅ executable | External-data parse/convert boundary |

**Non-executable fragments** in skill markdown files are marked with
`<!-- fragment non-executable -->` comments — they illustrate concepts but
are not expected to compile standalone.
