# Aikami UI, HUD and theme ecosystem — Q3 2026 proposal

Review date: 14 September 2026. Source baseline: `b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4` on `main`.

## Recommendation

Build one coherent game interface with three distinct responsibilities: **play**, **manage**, and **configure**. Give it a quiet, recognizable default appearance; let players independently choose their appearance, HUD layout, and accessibility preferences. Community creators should publish declarative theme packs and optional layout presets through the existing Hub infrastructure.

The strongest direction is an evolution of the repository's **Obsidian Chronicle** proposal, with substantially less permanent navigation while exploring. Do not turn Aikami into a desktop of floating windows. Do not make theme authors learn the DOM or write CSS selectors to change a panel border.

This is a source-based design assessment, not a playtest. I inspected the requested files, the UI composition and visibility policy, overlay and input services, preferences, community publishing, relevant contracts, the earlier design proposal, and the Obsidian sandbox source. I did not run the game, screenshot its production appearance, run its tests, or measure frame rates. Performance numbers below are proposed acceptance budgets. The available open-PR listing contained C-520 and C-521 asset work; implementation must refresh branch and contract state before starting.

## What the current code tells us

| Finding at the reviewed commit | Consequence | Recommended action |
|---|---|---|
| `app.css` imports the Aikami-owned theme and primitive classes. The theme package explicitly avoids hand-maintained TS palette copies. | The foundation is already suitable for extensible styling. | Preserve semantic classes and a single authoritative token source. |
| `game_ui_view.svelte` independently positions party, management navigation, HP/time/save, quests, hotbar, interaction hints, and optional media controls. | Widget addition has no shared layout or collision contract. | A game-owned HUD host assigns named slots and reserved regions. |
| `management_nav.svelte` places seven labeled section buttons at top-center. | Routine exploration pays the visual cost of a full management menu. | Default to one labeled Menu entry, direct shortcuts, and contextual entry points. Offer a pinned navigation strip as a preset option. |
| Visibility is mostly derived from `GameOverlayType`; clock and autosave use different exclusion sets. | States are individually reasonable but do not express a coherent global policy. | A tested matrix resolves mode, focus, capability, preferences, and critical notices. |
| A richer quest overlay already suppresses the smaller tracker. | Two presentations exist, but current code deliberately avoids displaying both together. | Reuse quest data; converge on one widget with compact/expanded density. Do not claim simultaneous duplicate quest widgets. |
| Optional quest/music cards own absolute positions and blur. | They cannot participate cleanly in a future layout editor. | Extract their positioning into the HUD host; preserve their actual domain controls. |
| `game_view.svelte` now renders one combat sidebar, uses `min(28vw, 32rem)`, and suppresses portrait staging for direct-control combat. | The older design document's duplicate-combat and `35vw` findings are stale. The current width still lacks a readable minimum on narrow windows. | Preserve the single action authority; adapt its container to available space and text size. |
| Explicit dark selection is already outside the OS media query. | That older defect is fixed. | Add scoped custom-theme tests without reopening a solved migration. |
| The global reduced-motion descendant override is inside the OS reduced-motion media query. | An application-selected reduced-motion mode alone cannot activate that block under an OS no-preference setting; individual components may have other handling. | Make explicit application reduction effective independently and test both combinations. |
| Inter, JetBrains Mono, and Source Serif 4 appear in font stacks. No font binaries appeared in the repository tree or font dependencies in the inspected client manifest. | A font declaration alone does not establish consistent rendering. | Audit all runtime font sources; bundle the selected licensed fonts and prove offline loading. |
| `GameOverlayService` already has a stack, focus-related state, input-field guards, pause/resume handling, and cleanup. InputActionService already handles keyboard/gamepad labels. | A second router or input authority would create regressions. | Extend these seams, with composition-level focus coordination. |
| C-502 minimap and C-503 quest markers are draft contracts. | Their capability cannot be assumed to exist or made a prerequisite for the redesign. | Reserve registry integration points; show their controls only after capability availability. |
| C-513 community publishing has authenticated reservation, private intake, moderation, and public asset delivery. | Hub distribution is not greenfield, but theme packages need different validation from ordinary images/audio. | Reuse identity, intake, moderation, content addressing, and download infrastructure; introduce a typed package path. |

Source links are listed at the end. A stale comment or contract status is not stronger evidence than the current implementation.

## The default design: Obsidian Chronicle, refined

The visual signature should be a quiet field journal with contemporary controls: warm ink, pale paper-colored text, a fine brass chapter mark, and a small violet selection accent. The game artwork supplies most of the fantasy. Aikami's shell must work beyond Emberwatch's autumn setting.

Use flat, largely opaque reading surfaces, not permanent glass panels over moving imagery. A narrow inset rule and one small corner ornament on a major heading can establish identity. Do not decorate every item, dialogue line, and HUD number. Use the existing Lucide icon family consistently where available; retain explicit labels on important actions rather than relying on emoji or hover tooltips.

### Typography

| Role | Recommended default | Proposed CSS sizing at normal UI scale |
|---|---|---|
| Controls, meaningful HUD values, item descriptions | Inter variable, 400/500/600 | 18px-equivalent for essential game text; comfortable spacing |
| Dialogue and narrative | Inter, optional Source Serif reader preference | 18–20px, line-height 1.55–1.7 |
| Section titles | Source Serif 4, restrained use | 24–32px; optical sizing where supported |
| Secondary metadata | Inter | 14–16px only for nonessential information; scale with player settings |
| Debug identifiers and technical notation | JetBrains Mono | 14–16px; avoid making normal gameplay look like a console |
| HP, currency and timers | Inter with tabular numerals | Same readable scale as surrounding content |

Inter is my recommendation for Aikami, not a universally best font. It already fits the implementation and provides tabular figures and useful disambiguation features [E1]. Source Serif 4 gives headings character without sacrificing the long-form reading surface [E2]. Bundle approved WOFF2 files, license notices, and language-aware fallbacks. Check actual face loading in browser/Tauri; computed `font-family` alone cannot prove it. Include accented Latin, long translated labels, CJK fallback, and an RTL fixture in layout verification.

The proposed essential-text baseline is informed by XAG 101, which recommends 18px at 1080p for PC experiences and scaling to 200% [E3]. CSS pixels, device pixels, DPI, viewing distance, and actual glyph height differ; inspect physical readability instead of asserting a CSS number automatically satisfies console guidance. A handheld/sofa preset should increase text and hit targets.

### Starting palette and material values

These are design seeds, not a certified theme. Validate every applied semantic pair and rendered state.

| Role | Dark default | Light variant |
|---|---|---|
| Scene-adjacent ink | `#171917` | `#EEE9DF` |
| Reading panel | `#222622` | `#FAF6ED` |
| Elevated surface | `#2D332E` | `#FFFFFF` |
| Main text | `#F1EBDD` | `#252B27` |
| Secondary text | `#BBBEB1` | `#596156` |
| Decorative rule | `#50584D` | `#CDC7B8` |
| Brass ornament | `#C5AA72` | `#745B2B` |
| Interactive violet | `#C1ADF0` | `#614389` |
| Focus | `#E1CA8B` | `#58431D` |

A decorative border is not a sufficient control boundary. Give inputs/buttons a distinct, contrast-tested outline and visible focus. Filled accent buttons need a separate tested text-on-accent role. Keep semantic health, warning, danger and success independent of branding and never color-only. High contrast is a user preference, not just another decorative community theme.

Use 4px spacing increments, 6–8px control corners, 10–12px panel corners, one quiet shadow/elevation step, and 120–160ms opacity transitions. These are starting values subject to visual validation. Do not apply opacity to a parent containing readable text. Reduce motion independently of OS preference; offer fully opaque panels and no ornamental animation. XAG 102 and 117 support checking actual backgrounds and controlling distracting movement [E4, E5].

## Navigation: connect management, separate system controls

Use one management shell with five stable top-level destinations:

| Destination | Existing features hosted there |
|---|---|
| Character | Player/selected actor sheet, capabilities, progression already supported |
| Inventory | Bag, equipment, comparison, legal item actions |
| Journal | Quests, notes, existing narrative/session records |
| Party | Roster, companion details, permitted relationship information |
| World | Known people/places/lore and existing faction reputation |

Quests becomes a Journal subview, while existing quest shortcuts open that subview directly. Reputation maps to the appropriate existing World/Factions content; preserve any companion-specific relationship entry points in Party. Keep a visible, searchable label so grouping does not make old features disappear. Do not add unsupported mechanics to fill empty tabs.

Inventory should open directly from its configured shortcut and from an item/loot context. Once open, switching to Character or Journal replaces the management content without stacking another full-screen modal. Preserve selection, filter, scroll anchor, actor, and origin. Back from an item inspector returns to its list. Closing management returns to its origin, including a conversation draft or Pause.

Pause is a compact system dialog: Resume, Save/Load where supported, Settings, Customize HUD, and Quit. It may provide a labeled entry to management, but it is not the parent required for every inventory visit. Settings remains a searchable, categorized screen shared by the main-menu and in-game entry points: Accessibility, Interface, Controls, Audio, Graphics, Gameplay, and existing AI configuration. AI provider internals should not occupy exploration HUD space.

The default exploration HUD shows one labeled **Menu** control. Mouse/touch users can reach any management destination in at most two activations; configured shortcuts open it in one. Offer a pinned section strip for players who prefer it. Preserve the current keybinding registry; do not arbitrarily reassign I/J/Esc or conflict with movement. Controller navigation needs logical focus order, bumper section switching, activate/back, repeat control, and device-appropriate glyphs—not merely keyboard event emulation. Consistency and predictable focus are supported by XAG 112 [E6].

Escape/Back has one owner: dismiss autocomplete or a local popover; cancel targeting when supported; leave a detail; close management to its origin; resume from Pause; open Pause only from unobstructed play. IME composition owns its keys. A hidden widget cannot retain tab focus or a transparent click-blocking rectangle.

## Clean HUD while moving

Default preset: **Adventure**. The center belongs to the scene. Menus and prompts stay in stable locations; contextual visibility never reorders neighboring controls.

| Widget | Adventure behavior | Player control |
|---|---|---|
| Menu entry | Small labeled control, stable top edge | Position among supported slots; compact navigation variant |
| Player/party status | Compact group; player always readable; companions collapse to count/status when healthy | Always / Contextual / Hidden; detail density |
| Current objective | One pinned objective, compact while exploring; temporary expansion on update | Always / Contextual / Hidden; 1–3 tracked objectives in expanded mode |
| Interaction prompt | Only when a valid action is available | Scale/anchor; optional hide with alternate action discovery retained |
| Exploration hotbar | Hide empty slots; contextual when populated or used | Always / Contextual / Hidden; supported dock positions |
| Clock/weather | Off by default; compact opt-in | Visibility and placement |
| Music player | Off by default; controls available in Audio | Off / brief track-change notice / pinned control |
| Minimap | Off by default and absent if capability unavailable | Register C-502 later; never an empty permanent box |
| Save success | Quiet, transient status | Adjustable notice preference |
| Save failure, disconnection affecting an action, game over | Persistent actionable system surface | Cannot be silently removed by a theme or ordinary HUD preset |
| Combat action/turn/target controls | One authoritative action surface | Presentation density and layout; theme cannot remove required actions |

For contextual health, reveal on resource change or relevant status, then settle after a configurable delay such as 6 seconds once stable. Do not wait for an animation to make actionable information available. For objectives, shorten presentation while moving without discarding the tracked quest; do not pulse every time movement starts. Keep selected/focused/actively dragged controls stable until the interaction ends. Show the same information through Character/Journal when optional visual widgets are hidden.

Provide **Adventure**, **Minimal**, **Tactical**, and **Readable** presets. Presets are starting layouts, not difficulty settings. Minimal hides most optional chrome. Tactical pins supported action/party/navigation details. Readable uses larger controls, opaque surfaces and fewer simultaneous groups. Keep a global temporary Hide HUD action with an obvious restore path; terminal errors and destructive confirmations remain reachable. A photo mode that suppresses all notices is a separate future feature.

### HUD editor

Enter through Settings → Interface → HUD or Pause → Customize HUD. In a paused preview of the current scene, widgets show labeled outlines. Allow drag to named anchors, ordering within a stack, density, scale and visibility policy. Provide equivalent keyboard/controller commands and form controls for all edits. Include Preview mode (Explore/Dialogue/Combat), Undo, Redo, Reset widget, Reset layout, Cancel and Save.

Start with constrained anchors and stack ordering, not arbitrary persistent screen-pixel coordinates. Reserve dialogue, action, subtitle, virtual keyboard and safe-area regions. Show why a slot is unavailable. At small widths, offer a scrollable editor list and a separate preview surface. Reflow is derived for the current viewport; it must not overwrite the user's desktop preset on a phone.

A conservative overlap policy packs optional groups toward edges, collapses lower-priority detail, then moves optional groups into a labeled overflow. Required controls retain a visible accessible home. There is no automatic dodge-the-player animation in v1: that needs a measured camera/occlusion bridge and can create distracting motion.

## Responsive play and combat

Desktop can show the scene plus one substantial reading or management surface. An optional wide-screen pinned companion surface is later polish. On compact windows or high text scale, switch to exclusive Scene / Conversation / Management surfaces while retaining navigation context. Use available content width, dynamic viewport height, virtual keyboard behavior, and safe insets; do not pick layout solely by device label.

Preserve the current single combat action authority and direct-control canvas. If a sidebar cannot fit a readable minimum width while leaving a usable scene, adapt to a bottom action area or focused action sheet. A management reskin must not execute, revalidate, or spend a combat action twice. Theme previews must never advance simulation or produce gameplay effects.

Keep the existing single-player menu pause behavior. Management-tab changes must not resume a frame or acquire extra pause ownership. Async work already committed may finish and update its originating context; switching appearance/layout must not remount its workflow. Future online play will need an explicit local-menu versus shared-time policy, which is outside these contracts.

## Architecture for customization and creators

Treat these as separate data products:

| Product | Owns | Must not modify |
|---|---|---|
| Theme pack | Palette, typography roles, approved control metrics, decorative assets | Action semantics, permissions, arbitrary layout/CSS/JS |
| HUD preset | Registered widget IDs, anchor/order/density/visibility | Fonts, campaign state, keybindings, security surfaces |
| Personal preferences | Text/UI scale, contrast, motion, opacity, personal overrides | Another user's exported defaults |

Appearance resolution: built-in baseline → selected theme/variant → personal appearance overrides → accessibility policy. HUD resolution: built-in layout → explicitly selected preset → personal widget overrides → current capability/state/viewport policy. Required system-surface protection is final. Applying a theme alone never overwrites a layout. Applying an attached layout is a separate explicit action.

The shared theme package owns the supported semantic vocabulary and primitive classes. Keep the existing Daisy-compatible class API. Pure reusable components handle focus, tabs, drawers and resize behavior. Feature ViewModels own UI projections and selection; services own domain work and persistence; the engine remains authoritative for simulation. A code-owned widget registry maps inert metadata to trusted view factories in composition. Pack authors cannot register new executable widgets.

For theme exchange, use a documented restricted profile of DTCG 2025.10 token JSON inside an Aikami package envelope. The DTCG format became stable in October 2025; it is a Community Group specification, not a W3C Recommendation [E7]. DTCG does not define HUD layout or security, so Aikami must define those separately. Do not implement the entire token specification to ship a theme picker.

Initially retain CSS as the built-in source. When the theme-authoring contract introduces token files, make those files authoritative and generate built-in CSS and documentation. Remove hand-maintained duplicates in the same change. Preserve token names and deprecate intentionally. Test scoped token application through generated Tailwind utilities, portals and native dialogs; root-resolved aliases can defeat a nested theme override if left untested.

### Creator experience and package lifecycle

The easiest workflow should be **Duplicate built-in → edit semantic roles → preview real widgets → validate → export or publish**. Offer a friendly editor for surfaces/text/accent/focus, typography, border/radius and ornament choices. Advanced JSON editing uses exactly the same validator. Theme previews use deterministic fixtures for exploration, dialogue, inventory, combat, long labels and error states; they must not include private campaign data in exports or Hub screenshots.

Use a versioned package with ID, version, author metadata, license, description, preview, compatible theme API range, token files, asset manifest and optional layout preset reference. Start with local-only WOFF2 and bounded PNG/WebP ornament assets; use trusted built-in icons in v1. No arbitrary CSS, JavaScript, HTML, SVG, external URLs, font-fetch rules, event expressions, or embedded gameplay content. Asset hashes establish integrity, not trust or rights.

Validate before preview and again at installation/publishing. Bound archive expansion, entries, bytes and dimensions; reject traversal, symlinks, case-colliding paths, unsupported versions, missing assets, cycles and out-of-range token values. Font parsing needs a supported validation/sanitization path; until that path exists, reject custom font assets while still allowing built-in font role selection. This is a concrete scope gate, not permission to label incomplete custom-font support complete.

Keep the installed version immutable, download into staging, verify it, then atomically switch the active pointer. A failed update leaves the previous working theme active. Revert is one action. Uninstalling an active pack restores a safe built-in appearance. Offline boot uses installed bytes with immediate built-in fallback if corrupt. Do not contact Hub to determine whether the game may start.

Hub gets a discoverable Themes category, theme detail previews, API compatibility, variant/language metadata, download/install, report/moderation and version history. Reuse C-513's private-intake and moderation approach. A theme preview skins a contained fixture, never Hub's own account, billing, moderation or navigation controls. A native-client deep link carries an identifier; the client fetches metadata from the configured trusted Hub and validates bytes. Provide download/import fallback for browsers without a usable native handler.

## Delivery and definition of success

Four provisional full contracts follow the repository TEMPLATE and split rule:

1. **C-527 — Default play shell and management navigation.** Production interface, readable default theme, fixed HUD slots, single input/focus policy and responsive combat containment.
2. **C-528 — Player HUD customization.** Registry-backed visibility, editor, presets, persistence, legacy preference migration and responsive collision handling.
3. **C-529 — Theme runtime and creator tooling.** Declarative format, token generation, local editor/import/export, validation, scoped application and fallback.
4. **C-530 — Hub theme sharing.** Publish/moderate/browse/download/install/update using existing identity and storage infrastructure.

IDs are free in the reviewed tree but are not reserved. Recheck before registering. Each contract has one independently useful outcome and must pass its production journeys. The first PR should implement C-527 only. Do not make the full ecosystem a giant first PR, and do not call a sandbox-only result production-complete.

Success is measured through: a clean exploration screenshot; Inventory → Character → Journal without losing return state; keyboard/controller navigation without world-input leakage; 200% text reflow; hide/customize/reload persistence; theme preview/cancel/revert; local offline installation; and creator publish → moderated visibility → second-device installation. Use real state transitions and negative cases, not tests that mirror implementation details. Validate visual states against actual scenes; automated screenshots/AI scores supplement behavioral assertions and human readability review.

## Evidence and research

Repository observations are pinned to the reviewed commit:

- [apps/frontend/client/src/app.css](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/apps/frontend/client/src/app.css)
- [apps/frontend/client/src/lib/views/game/game_view.svelte](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/apps/frontend/client/src/lib/views/game/game_view.svelte)
- [apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte)
- [apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/apps/frontend/client/src/lib/views/game/ui/game_ui_hud_visibility.ts)
- [apps/frontend/client/src/lib/views/game/ui/hud/management_nav.svelte](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/apps/frontend/client/src/lib/views/game/ui/hud/management_nav.svelte)
- [apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts)
- [apps/frontend/client/src/lib/services/game/input_action_service.svelte.ts](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/apps/frontend/client/src/lib/services/game/input_action_service.svelte.ts)
- [packages/frontend/theme/src/index.ts](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/packages/frontend/theme/src/index.ts)
- [packages/frontend/theme/src/lib/aikami_theme.css](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/packages/frontend/theme/src/lib/aikami_theme.css)
- [packages/frontend/theme/src/lib/aikami_ui.css](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/packages/frontend/theme/src/lib/aikami_ui.css)
- [docs/design/game_ui_hud_overhaul.md](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/docs/design/game_ui_hud_overhaul.md)
- [docs/contracts/C-502-minimap-hud.md](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/docs/contracts/C-502-minimap-hud.md)
- [docs/contracts/C-503-quest-marker-hud.md](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/docs/contracts/C-503-quest-marker-hud.md)
- [apps/frontend/hub/src/lib/server/api/asset_community.ts](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/apps/frontend/hub/src/lib/server/api/asset_community.ts)
- [docs/contracts/TEMPLATE.md](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/docs/contracts/TEMPLATE.md)
- [docs/contracts/SHARED_SECTIONS.md](https://github.com/BearlySleeping/aikami/blob/b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4/docs/contracts/SHARED_SECTIONS.md)

External primary sources, retrieved 14 September 2026:

- [E1: Inter project](https://rsms.me/inter/).
- [E2: Adobe Source Serif](https://github.com/adobe-fonts/source-serif).
- [E3: Xbox Accessibility Guideline 101 — Text display](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/101).
- [E4: Xbox Accessibility Guideline 102 — Contrast](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/102).
- [E5: Xbox Accessibility Guideline 117 — Visual distractions and motion](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/117).
- [E6: Xbox Accessibility Guideline 112 — UI navigation](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/112).
- [E7: DTCG Format 2025.10](https://www.designtokens.org/TR/2025.10/format/).

The design choices, palette, architecture, presets and budgets are recommendations inferred for Aikami, not claims that these sources prescribe this specific interface or that a universal best Q3 2026 game UI exists.
