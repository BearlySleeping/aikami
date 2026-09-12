# Game UI/HUD overhaul — Obsidian Chronicle

**Status:** Design proposal for discussion, not an approved implementation contract.

**Scope:** Game shell, HUD, management screens, NPC/party/DM dialogue, combat, dice, generated media, accessibility, themes, and frontend architecture.

**Review basis:** Source review of `game_view.svelte`, `app.css`, the game UI router and ViewModels, combat sidebar/overlay, dialogue and party-chat views, shared messaging/dice components, character sheet, inventory, reputation, journal service, and shared theme. No live-browser or usability validation was performed. Findings below distinguish code observations from proposed behavior. Existing unrelated working-tree changes are out of scope.

## 1. Recommendation

Build **one coherent play interface**, not a larger collection of overlays.

The proposed system has three primary surfaces:

1. **Scene:** exploration or encounter visuals, with a small contextual HUD.
2. **Chronicle:** the active conversation and relevant narrative/mechanical events.
3. **Codex:** a single management workspace for character, inventory, journal, party, and world information.

Names are working labels. Navigation should use familiar labels such as **Inventory**, **Journal**, and **Party**, not require players to learn invented terminology.

**Default rule: scene plus one substantial reading/work surface.** Opening management normally collapses the Chronicle, preserving its draft, selected conversation, and scroll position. Side-by-side pinning is an optional wide-screen enhancement, not the default.

The visual direction is **Obsidian Chronicle**: warm ink surfaces, ivory text, restrained brass detailing, small rune-purple accents, and readable contemporary controls. Fantasy atmosphere comes from artwork, portraits, material hints, iconography, and sparse headings—not blackletter body text, busy parchment, or glowing borders everywhere.

The most important architectural change is not a new stylesheet. It is unifying ownership of interaction, focus, actions, and feedback.

## 2. Critical assessment of the current implementation

### Observed problems

| Observation | Source | Implication |
| --- | --- | --- |
| Combat changes the root layout to `35vw 1fr`. | `apps/frontend/client/src/lib/views/game/game_view.svelte:28` | Fixed proportions do not adapt to readable text width, small windows, large text, or ultrawide displays. |
| The root mounts `CombatSidebar`; the UI layer also mounts `CombatOverlay`, which renders `CombatView`. Both combat views contain HP, actions, logs, and dice. | `game_view.svelte:32`, `game/ui/game_ui_view.svelte:127`, `combat/combat_sidebar.svelte`, `combat/combat_view.svelte` | Two simultaneous combat presentations exist in the component graph. Consolidate controls before adding features. Runtime mode transitions still need browser verification. |
| HUD elements occupy independently positioned corners with local z-index choices. | `game/ui/game_ui_view.svelte:54–127` | Adding another widget is easy; maintaining a coherent layout and collision policy is not. |
| NPC dialogue uses a fixed `45vh` card with large portraits; party dialogue is a separate modal and composer. | `game/ui/overlays/dialogue/dialogue_overlay.svelte:122–182`, `overlays/talk_to_party/talk_to_party_view.svelte` | Long text, small screens, and switching recipients have inconsistent experiences. |
| The dialogue portrait row includes a hardcoded companion asset. | `dialogue_overlay.svelte:150` | Party identity should come from the selected actor/roster, not a placeholder visual. |
| `GameDice` renders `absolute inset-0` with a dimmed, blurred backdrop. | `apps/frontend/client/src/lib/components/game/game_dice.svelte:77` | The screen takeover is built into the component, not a small placement problem. |
| A compact resolved `DiceCard` already exists, while dialogue also has a separate result-banner shape. | `components/game/dice_card.svelte`, `dialogue_overlay_view_model.svelte.ts` | There is a useful foundation, but pending, rolling, and resolved dice should become one persistent record and one card family. |
| Views contain mapping, lookup, action dispatch, local feature state, and—in combat/party HUD—service imports. | `dialogue_overlay.svelte`, `combat_sidebar.svelte`, `game/ui/party_hud.svelte` | UI redesign is an opportunity to restore thin views, not move more orchestration into markup. |
| Dialogue VM is approximately 3,085 lines; combat VM approximately 1,811; UI VM approximately 872. | Corresponding `*_view_model.svelte.ts` files | Responsibilities are already too broad for an additional universal HUD controller. Split by real workflows and ownership. |
| `app.css` defines `shake` twice and also defines `.animate-shake` separately from its theme animation token. | `apps/frontend/client/src/app.css:9,13,34,68` | The later keyframes win. Animation has conflicting definitions and needs one owner plus a reduced-motion policy. |
| Explicit dark-theme selectors are inside `prefers-color-scheme: dark`. | `packages/frontend/theme/src/lib/aikami_theme.css:59–61` | As written, that explicit dark override does not work under a light OS preference. Fix before offering user-selected themes. |
| Dice styles hardcode colors and a font family despite the shared token system. | `components/game/game_dice.svelte`, `components/game/dice_card.svelte` | A future theme cannot reliably skin the game by changing root tokens alone. |

`app.css` is only a small part of the design system. The shared palette and primitives live in:

- `packages/frontend/theme/src/lib/aikami_theme.css`
- `packages/frontend/theme/src/lib/aikami_ui.css`

Changing only the two requested files would leave most UX and visual inconsistency intact.

### Preserve these foundations

- Svelte/DOM for readable and accessible interface; PixiJS for world rendering.
- `GuidedComposer`, `RichMessageList`, and `RichMessageRow` as the shared messaging foundation.
- Existing inventory/equipment, quest, relationship, party, journal, and character-sheet capabilities.
- Existing slash completion, drafts, streaming cancellation, TTS, and capability-error handling.
- Device-local campaign persistence and offline boot.
- C-490's distinction between presentation-only **Rephrase** and campaign rewind. The current campaign UI intentionally gates transcript editing/branching; the redesign must not accidentally reopen those controls.

This is a consolidation and controlled migration, not a ground-up rewrite.

## 3. Interaction principles

1. **Scene first, decisions second, reference material on demand.**
2. **One authoritative control for each action.** No duplicate Attack or End Turn buttons in competing surfaces.
3. **Stable geography.** Combat and dialogue change contextual content, not the entire application's interaction model.
4. **Progressive disclosure.** Show what matters now; make the full explanation easy to inspect.
5. **Readable before decorative.** Long conversations are a core gameplay surface.
6. **Everything consequential leaves a trace.** Rolls, resource costs, rewards, and relationship changes can be inspected later.
7. **AI is not rules authority.** Generated prose cannot silently grant items, spend resources, or change a completed roll.
8. **Never confuse observing with acting.** Reading a feed, changing its filter, or opening an inspector must not send a message or spend a turn.
9. **Preserve context.** Returning from a sheet restores the prior conversation, target, draft, and scroll anchor.
10. **Do not display unavailable systems as fake depth.** A UI category is not evidence that guild banking, spell preparation, or other mechanics already exist.

## 4. Visual system

### Typography

Recommended starting point—not a claim of a universally optimal font:

| Role | Recommendation | Initial sizing |
| --- | --- | --- |
| Interface and body copy | Keep **Inter** as the readable default. | 14–16px equivalent in rem |
| Dialogue and narrative | Inter with generous leading; optional reader preference for serif later. | 16–18px, about 1.5–1.65 line height |
| Major headings | Add **Source Serif 4** as a centrally registered display role, used sparingly. | 20–28px, not all caps |
| Dice notation and technical values | Existing **JetBrains Mono**. | 13–15px |
| Secondary metadata | Inter; do not put essential instructions here. | 12–13px |

Use tabular numerals for HP, currency, resources, and initiative without forcing the entire UI into monospace. Reserve broad reading widths of roughly 55–75 characters for focused narrative; a docked rail will naturally be narrower and must have a Focus conversation option.

The current style policy supports `font-sans` and `font-mono`. A display role requires an explicit design-system addition and updated guidance, not arbitrary inline fonts. Register approved roles centrally; bundle licensed font files locally with language-appropriate fallbacks. Verify that declaring a font actually loads it. No Google Fonts request should be a boot dependency.

### Palette and material

| Semantic role | Visual direction |
| --- | --- |
| Scene-adjacent surface | Deep warm charcoal/ink, not absolute black |
| Reading panel | Slightly lighter opaque ink |
| Elevated inspector | Distinct raised surface, quiet border |
| Primary text | Warm ivory, not pure white |
| Secondary text | Legible muted neutral, not low-opacity essential copy |
| Ornament / chapter detail | Desaturated brass |
| Primary interactive accent | Rune purple, used consistently and sparingly |
| Magic/resource accent | Related violet treatment, distinguished by labels/icons |
| Health | Legible health treatment; danger accent when low rather than constant alarm |
| Success / caution / danger | Semantic colors plus text and symbols |
| Focus | Dedicated high-contrast focus ring, not just a hover glow |

Palette values belong in the shared theme, never hardcoded in feature components. Add semantic resource/outcome roles only where they express real meaning. A relationship value must not borrow `error` merely because it is negative.

Use fine borders, restrained elevation, compact corner radii, and small decorative flourishes at section boundaries. Avoid saturated bubbles on every message, emoji as the main icon system, full-panel background textures, and blur behind entire paragraphs. Use one consistent SVG icon family with text labels for important actions.

### Density and motion

- Comfortable default, compact optional, independently scalable text.
- Touch targets around 44px where practical; do not reduce hit areas with compact typography.
- Short UI transitions, approximately 120–180ms as an initial target.
- Dice animation stays inside its card and can be skipped or disabled.
- Respect reduced motion across shakes, pulses, bouncing indicators, reveals, and scene-adjacent UI—not only one component.
- No perpetual animation competing with a conversation.
- Higher-opacity reading surfaces and a high-contrast option override decorative theme preferences.

## 5. The play shell

### Wide desktop, active conversation

```text
┌ Location · scene context ───────────── Saved · Menu ┐
│                                                    │
│ Party     SCENE                       CHRONICLE     │
│ portraits                             To: Mira      │
│ + status                              conversation  │
│                                       inline roll  │
│                                       consequences │
│ Pinned objective                      suggestions  │
│                                       composer     │
├ Character · Inventory · Journal · Party · World ────┤
│ Contextual actions / exploration shortcuts          │
└────────────────────────────────────────────────────┘
```

This is a hierarchy sketch, not a requirement to show every region at maximum density.

### Persistent HUD

- **Context header:** location; relevant time/weather compactly; quiet save status; system menu. Save failures become persistent actionable notices, not fleeting toasts.
- **Party surface:** real portraits with HP/conditions and active actor. Player is included; avoid a second unrelated player-HP cluster. Collapse or summarize large rosters.
- **Objective:** one tracked quest with an expandable next step. Do not render two competing quest trackers.
- **Action dock:** a small set of pinned abilities/items during exploration; legal turn actions during combat.
- **Management navigation:** labeled entry points to the five sections. Keyboard shortcuts supplement rather than replace discoverability.
- **Event feedback:** small recoverable notices for inventory, XP, quests, and reputation; detailed history lives in the Chronicle/Journal.

Do not permanently display experience bars, alignment, every faction score, all party thoughts, full combat formulas, and a music player. These are accessible details, not equal-priority HUD residents. Music can be a compact opt-in control.

### Layout behavior

- **Exploration:** Chronicle closed or shallow peek; scene dominates.
- **Dialogue:** Chronicle opens in the same place; actor and audience become explicit.
- **Combat:** Chronicle remains; initiative and contextual action economy appear. Avoid duplicating party information in a second equally large strip.
- **Management:** one Codex workspace replaces the primary reading rail or expands over part of the scene. It retains a clear Return to play action.
- **Focused reading:** expands the active conversation using the same component and state. Do not maintain a second transcript implementation.

A starting dock width around 24–32rem is reasonable, but actual layout decisions must respect remaining scene width, text scale, and window height. No unconditional `35vw`. Allow a bounded, keyboard-operable separator and Reset layout; do not build a general draggable-window desktop.

On compact screens use exclusive **Scene / Chronicle / Codex** surfaces with a shared contextual status/action area. Management rows open a full-screen detail view with Back. Maintain composition under the virtual keyboard using dynamic viewport units and safe-area insets. Test at 200% text scale, not only nominal device widths.

For single-player management, pausing simulation is a sensible default where supported. Show the paused state. A nonmodal inspector is different from a paused management workspace; neither should accidentally consume game input. Confirm time/pause semantics against actual game rules before implementation.

## 6. Information architecture

### Five management sections

| Section | Owns | Default interaction |
| --- | --- | --- |
| **Character** | Summary, HP/AC/initiative/speed, abilities, saves, proficiencies, skills, class features, level/XP, spells/actions, traits/alignment | Actor summary first; deeper rules via tabs/details |
| **Inventory** | Bag/items, equipment, comparisons, consumables, currency, capacity, attunement/containers if supported | Bag and equipped state together, one item inspector |
| **Journal** | Quests, objectives, personal notes, AI summaries, session recaps, links to history | What to do next, then searchable knowledge |
| **Party** | Roster, active/reserve state, companion details, relationships, allowed reactions/thoughts, party management | Select a companion, inspect or act contextually |
| **World** | Known people/places, factions/guilds, discovered lore, gallery | Knowledge and affiliations, not omniscient game data |

Do not create five separate implementations of actor details. Character defaults to the player; selecting a companion from Party opens the same actor inspector with allowed capabilities. Equipment and spells always show the current actor prominently. Viewing an NPC does not imply permission to edit its sheet.

### Inventory and equipment

- Search, type filter, sorting, favorites, and optional compact list/grid view.
- Select an item to inspect description, quantity, weight, value, properties, and applicable actions.
- Compare against the relevant equipped slot, with explicit stat deltas and requirements.
- Equip, unequip, use, transfer, split, drop, and sell only when legal.
- Drag-and-drop is a convenience; every action also works by click, keyboard, and touch.
- Locked/favorite protection for accidental sale/drop; confirmation for meaningful irreversible actions, not every equip.
- Item use during combat goes through the same action/resource validation as the action dock.
- Vendor UI reuses item rows, comparisons, and transaction feedback rather than becoming another inventory system.

### Character, skills, spells, and advancement

Start with useful facts, not a wall of modifiers. Expand any derived value to show its contributing sources. Search spells/actions; distinguish known, prepared, available, and unavailable where the ruleset supports those concepts. Show costs, range, target type, concentration, and resource availability in the action inspector.

Combat spell selection lives near the action dock, not behind several Codex tabs. Character management handles learning/preparation and full reference browsing.

XP is quiet until earned or a level-up becomes available. A level-up workflow previews choices and resulting changes before commitment. Keep raw JSON/AI-context inspection in an explicit advanced/developer surface, not beside ordinary gameplay controls.

**Ruleset-sensitive, not hardcoded D&D assumptions:** action economy, rest behavior, spell slots, critical hits, alignment, and automatic success/failure differ by system and edition. The UI renders capabilities and explanations supplied by rules. A natural 20 is not universally an automatic successful skill check.

### Journal and conversation notes

Keep three concepts distinct:

1. **Quest journal:** authoritative objectives, progress, outcomes.
2. **Personal notes:** player-authored, freely editable.
3. **AI summaries/recaps:** generated interpretations with source links and timestamps.

A summary should link to its conversation or message range. Mark stale summaries after supported source changes. Allow a player correction or an edited copy without silently rewriting the original evidence. Regenerating a summary does not change quests, relationships, or the underlying transcript.

Useful groupings: session, quest, person, location, tag, unresolved promise, and player-pinned note. Full-text search should work locally. The Journal links into the existing history rather than maintaining a second copy of conversation data.

### Relationships and party thoughts

Lead with understandable labels and recent meaningful events. Show exact scores only when the active game design intentionally exposes them. Do not invent extra relationship dimensions merely because a new panel can display them.

Thoughts should mean authored/generated **in-world reactions available to the player**, not the model's reasoning trace, private prompts, or hidden plot knowledge. Private content and actor knowledge must be filtered before UI projection and before constructing an AI prompt—not merely hidden with CSS.

Transient party reactions appear quietly near the associated event and remain in history. Relationship details explain the known source of changes without exposing secret motivations. Alignment belongs among roleplaying traits; avoid an unsolicited moral score that constantly judges each line of dialogue.

### Guilds, factions, and gallery

Separate **reputation** from **membership**. A member may have a rank, permissions, dues, obligations, and services only when those mechanics exist. Faction reputation can exist without membership. If guilds become a central gameplay loop, a contextual Guild shortcut can be promoted; do not reserve permanent empty HUD space now.

Gallery is a shared collection of media references, not copies. Open it directly from any image, Chronicle tool, or World collection. Filter by session, scene, actor, and media type. Every generated image links back to its origin and version history. Avoid forcing users to remember whether an encounter image belongs to World or Journal.

### Contextual shortcuts matter more than taxonomy

- Loot → compare → equip/store → return to scene.
- Quest update → affected objective → related note/person.
- Actor portrait → sheet/equipment/spells for that actor.
- Spell mention → rules details or legal action preview.
- NPC name → known relationship and past conversations.
- Image → variations, generation details, source exchange.

Preserve navigation breadcrumbs and return state. Keep routine actions one or two interactions from their context; the full management hierarchy is a fallback, not a mandatory route.

## 7. Dialogue and the Chronicle

### One infrastructure, explicit conversation contexts

Unify the composer and typed event renderer. Do **not** merge every conversation into an unreadable global feed or share unrestricted AI context across recipients.

Distinguish:

- Active NPC/party/DM conversation.
- Encounter record of consequential actions and outcomes.
- Optional chatter and technical/system detail.

Visible history filters never change the message destination. Switching the destination never silently sends the existing draft.

### Composer

```text
To: Mira ▾       Say / Act       Heard by: nearby party
─────────────────────────────────────────────────────
I show her the sealed letter and ask about the crest…
─────────────────────────────────────────────────────
Commands /    Media    Voice                  Send →
```

- **To:** active NPC, Party, a permitted companion conversation, or DM.
- **Say / Act:** speech versus an in-world action; DM context changes to a clear question/instruction affordance where appropriate.
- **Audience:** who can hear/know the exchange. Do not imply privacy the simulation cannot enforce.
- **Drafts:** scoped by campaign/conversation/recipient/mode. Preserve them during inspection and focus changes.
- **Send:** explicit text submission.
- **Continue:** a distinct generation action; avoid an empty Send button that unexpectedly creates narration.
- **Streaming:** show who is responding, a clear Stop action, and retained draft/pending status. Prefer one in-flight turn per conversation initially; additional text is visibly a draft or queue entry, never silently sent.
- **Suggestions:** at most a few relevant choices, secondary to free text. A dangerous suggestion opens a meaningful action preview rather than firing a hidden irreversible command.

Keep recipient selection stable and discoverable. The current VM already exposes an address mode; connect and extend the actual routing capabilities instead of shipping a cosmetic selector. DM means an out-of-character facilitator context, not a player-accessible system-prompt editor.

### Slash commands

Slash autocomplete should expose usage, arguments, scope, and validation. Buttons and slash commands call the same typed command dispatcher.

Potential commands include `/roll`, `/inspect`, `/note`, `/image`, `/cast`, and `/help`, but only commands supported by domain capabilities should be advertised. Recipient shortcuts must update the visible recipient chip. A command may not silently override the audience.

Commands embedded in generated prose are not executable instructions. State-changing commands still require authorization, validation, and any appropriate intent confirmation.

### Message presentation

Use distinct but related rows/cards:

- DM narration: readable text block, minimal bubble decoration.
- NPC/party/player speech: named speaker, small portrait, restrained role treatment.
- Player action: a clearly labeled action entry.
- Roll/check: persistent inline card.
- Rule consequence: compact inspectable result linked to its action.
- Image: bounded attachment with reserved dimensions and tools.
- Quest/reputation/reward change: concise event with a deep link.
- System failure: actionable status attached to the affected operation.

Hide secondary message tools until hover or keyboard focus; touch gets an explicit menu. Never make hover the only route. A focused transcript can hide portraits and nonessential chrome without changing its underlying state.

### Scroll and reading behavior

- Follow new content only while already following the bottom.
- While reading history, show a Jump to latest/unread affordance rather than stealing scroll.
- Preserve the visible message anchor when an image loads or earlier history is fetched.
- Avoid full transcript announcement on every streamed token; announce useful completed chunks/status through a controlled live region.
- Search and older-history loading must remain usable with long campaigns.
- Timestamps and provenance remain inspectable but visually secondary.

### Generate, retry, rephrase, and replay are different

| Control | Meaning | Allowed mechanical effect |
| --- | --- | --- |
| **Send / Continue** | New intent or subsequent narration | Only validated effects associated with a new turn |
| **Retry failed response** | Resume/retry the same operation | No duplicate previously committed effects |
| **Rephrase** | Alternate wording for the eligible terminal NPC response | None; preserve established facts and outcomes |
| **Image variation** | New media attached to the same source | None |
| **Mechanical reroll** | Rules-authorized new roll | Explicitly validated cost/permission and recorded history |
| **Replay/rewind** | Return to an earlier world state | Remains gated in campaign play; not part of this UI refactor |

Preserve C-490 restrictions. `applyState: false` is necessary but not sufficient: rephrased prose must not claim a different outcome or invent an uncommitted reward. Supply established outcomes as constraints, retain the original, and label presentation alternatives. A future rewind needs coordinated world-state snapshots and branching semantics, not just transcript truncation.

### Image generation

An image card has queued/generating/ready/failed/cancelled states. Its menu offers View, Save to gallery, Generate variation, and Edit generation settings where available.

The focused editor can expose prompt, negative prompt, seed, model/preset, aspect ratio, and reference assets supported by the provider. Show inheritance from campaign defaults and provide Reset to inherited settings. Do not put every generation parameter in the main composer.

Variations retain the original and provenance. Regenerating an image does not re-run dialogue. Requests remain attached to their original campaign/conversation/source if the player switches surfaces. Store stable local asset references; do not make expired remote URLs the only copy of campaign media.

### TTS

Provide Play/Pause/Stop, voice availability, playback state, and optional auto-read. Voice preference can vary by actor where supported. Decide whether auto-read includes narration, dialogue, or both; default away from reading combat diagnostics.

Switching conversations should stop/pause playback by default unless background playback was explicitly enabled. Never unexpectedly read private content aloud. Rephrasing a message invalidates or replaces its associated audio explicitly. Failure of TTS must not block reading, sending, or resolving a turn.

## 8. Inline dice: a first-class interaction

**Replace the screen-covering dice wrapper, not merely its z-index.** Evolve the existing compact DiceCard into pending, rolling, and resolved variants, preserving the same event identity.

```text
Persuasion — convince Mira to open the gate
Your bonus: CHA +2 · proficiency +2
DC 15 · Success: access granted · Failure: she refuses

[ Roll d20 + 4 ]
```

After resolution, the same card becomes:

```text
Persuasion   d20 [13] + 4 = 17   vs DC 15   SUCCESS
Mira agrees to open the gate.                 Details ▾
```

Show DC and stakes only when the active rules/mode permit disclosure. If difficulty is hidden, label that explicitly; do not reveal secret data through a tooltip or AI prompt. Do not invent success odds where the rules cannot compute them reliably.

Important behavior:

- Clicking Roll changes only this card; the transcript and reading/navigation controls remain available.
- Block only actions that depend on the unresolved check, not unrelated reading or accessibility controls.
- Space/Enter trigger a semantic button once; no duplicate native-click plus key-handler roll.
- One authoritative result per check ID. Multiple renderers never roll independently.
- Persist the result before presentation can be lost; animation does not control game correctness.
- Reduced-motion/instant-result preferences skip animation without changing timing-dependent rules behavior.
- Reopen/reload shows the recorded result, not a new roll.
- Advantage/disadvantage, discarded dice, modifiers, and effect sources are inspectable when supported.
- Freeform `/roll` is labeled as a free roll and cannot satisfy an existing encounter check merely by matching notation.
- Critical labels follow the ruleset, not just `value === 20` or `value === 1` in presentation code.

The current manual dialogue flow waits through fixed animation delays before narrative resolution. Separate that presentation choreography from the authoritative operation and its recovery state. A durable pending/completed operation should be recoverable even if the panel closes or the app restarts.

## 9. Combat without changing applications

Keep the same shell and Chronicle. Replace the duplicated sidebar/overlay interface with:

1. **Initiative/turn context:** names and portraits, current actor, round, relevant conditions.
2. **Scene:** existing encounter visuals or tactical map according to current gameplay; this redesign does not require rebuilding combat rendering.
3. **Action dock:** actions appropriate to the selected/current actor.
4. **Target/action inspector:** costs, range, constraints, and outcome details when relevant.
5. **Chronicle:** narration, rolls, damage, status effects, and encounter images.

Where the ruleset supports it, show Action, Bonus action, Reaction, and Movement in one compact economy row. Show spell slots/charges/concentration in context rather than as dozens of permanent icons. Disabled actions explain why and what the player can do instead.

The basic action set should be authored by rules/capabilities: Attack, Cast, Item, and other supported maneuvers—not a UI-hardcoded list pretending all D&D systems are identical. End Turn has one stable home. Warn about meaningful remaining resources or pending choices without forcing a confirmation on every ordinary turn.

### Freeform action workflow

“I kick the brazier toward the goblins” becomes:

1. Interpret player intent.
2. If ambiguous or costly, present the proposed target, cost, and check.
3. Player confirms/corrects when necessary.
4. Domain logic revalidates current turn, resources, and targets.
5. Commit once, resolve, and append consequences.

Simple, predictable legal actions should not acquire an unnecessary confirmation dialog. The explanation/preview is for uncertainty and consequential decisions.

Keep critical numbers readable, but allow narrative-first and detailed-log preferences. A hit card can collapse its formula while retaining damage and conditions. Never infer authoritative dice/damage by parsing generated prose; migrate the existing enriched-log parsing toward typed domain results, with a legacy plain-text fallback.

Victory becomes an encounter-summary card with XP, loot, injuries, quest effects, and Continue. It should not be two separate result screens. Defeat, death saves, revival, retreat, and game-over behavior follow the actual rules and save policy, not generic “your journey has ended” copy.

## 10. Architecture and DX

### Responsibility boundaries

| Layer | Owns | Must not own |
| --- | --- | --- |
| Shared theme | Semantic colors, typography roles, metrics, shared primitive classes | Actor/game state or feature-specific positioning |
| Pure complex UI components | Tabs, inspectors, transcript structure, inline cards, accessible resize/focus behavior | Services, repositories, rules, AI calls |
| Feature ViewModels | UI state, selected actor/tab/target, read models, commands delegated through injected capabilities | Persistence, rules engine, provider SDK orchestration |
| Domain/workflow services | Turn/check resolution, action validation, generation jobs, inventory operations, durable state | DOM refs, open tab, hover state, panel size |
| Repositories / local storage | Campaign data and operation persistence | Presentation state or layout |
| Engine/bridge | Simulation and serialized commands/events | DOM controls or Svelte per-frame updates |

Production wiring stays in sibling `*_composition.ts` modules. ViewModels expose testable `create*ViewModel` factories and consume narrow capabilities. One lifecycle owner initializes/disposes each ViewModel. Opening a second presentation of the same domain data must not initialize a second combat workflow.

Do not replace the large dialogue VM with one larger Chronicle VM. Extract cohesive workflows: conversation interaction, composer intent, generation/media operations, and check resolution. Local layout/drafts-in-progress remain appropriately scoped; persisted drafts and actual shared domain facts use existing persistence/workflow capabilities.

### Suggested client organization

Illustrative boundaries, not a requirement to create every folder or migrate all existing paths immediately:

```text
views/game/
  game_view.svelte                    # small composition surface
  shell/                              # layout, presentation mode, navigation
  chronicle/                          # active conversation/event projection
  codex/                              # section host and navigation history
  hud/                                # party, objective, context, action dock

views/combat/                         # turn/action interaction, not another shell
views/inventory/                      # retain and refactor existing feature
views/quest/                          # retain domain-backed quest feature

components/messaging/                 # evolve existing shared client components
components/game/                      # pure actor/resource/roll/action cards

services/game/                        # existing domain services + narrow workflows
```

Share a complex component in `packages/frontend/components` only when it is genuinely cross-app and receives all business data via props/callbacks. Do not wrap every primitive button in a new Svelte component.

### Separate state dimensions

The existing active-overlay switch bundles several different concerns. Model them separately:

- Game mode: exploration, encounter, transition, etc.
- Presentation mode: scene, conversation focus, management.
- Open management section and selected entity.
- Conversation ID, speaker/actor ID, recipient, and audience.
- Focus/input scope and modal stack.
- Persisted domain operation status.

Opening Inventory is not a new game mode. Closing Chronicle is not ending a conversation. Switching a feed filter is not changing the recipient. Clearing a panel is not cancelling a committed action.

An explicit supported-state policy is better than a growing pile of independent booleans. It need not introduce a heavyweight state-machine library.

### Typed timeline, not a full event-sourcing rewrite

Introduce a discriminated display/event model for speech, narration, actions, rolls, consequences, media, and status. Use stable IDs plus campaign/conversation/turn/check/source references. Preserve actor identity, audience, sequence, generation status, and provenance.

Build projections/adapters over current persisted records and service outputs. Incrementally add missing structured data and migrations. **Do not make a universal event-sourced database rewrite a prerequisite for an inline dice card.** Rendering an event or hydrating history must never execute it.

When domain payloads cross packages or persistence boundaries, define TypeBox schemas in `packages/shared/schemas`, inferred types in `packages/shared/types`, and shared labels/registries in constants. UI-only view models stay local. Avoid duplicating domain shapes inside Svelte files or service exports.

### Extensibility without a plugin framework

- A small typed section registry can provide section ID, label, order, availability, and badge policy.
- Keep metadata inert; view/VM factory lookup belongs in composition.
- A typed command registry can serve buttons, slash autocomplete, keyboard shortcuts, and command search.
- Availability and execution route through domain capabilities; the registry does not become the rules engine.
- Reuse selected-actor and selected-item inspectors rather than copying whole sheets.
- Use static imports for ordinary modules according to project conventions. Lazy-mount panels/data where useful; reserve dynamic imports for approved heavy/platform-specific boundaries.
- Add a provider/ruleset adapter only for a real variation already needed, not speculative abstraction.

### Async and persistence correctness

Each asynchronous action captures its originating context and operation identity. A late response cannot land in a newly selected NPC conversation or a different campaign.

Use cancellation for cancellable work and operation tokens/revisions for stale-result rejection. Revalidate action resources at commit. Idempotency prevents repeated clicks, retries, remounts, or reloads from granting XP twice or spending a slot twice.

For operations combining authoritative effects and a visible record, use transactional persistence where possible, or an explicit recoverable operation journal where the existing engine/storage boundary prevents one transaction. Do not claim a database transaction spans PixiJS, an AI provider, and local storage.

Local game/save/history access remains available without sign-in. A model can be unavailable even when the game is offline-capable: preserve drafts, explain which generation capability is missing, and offer setup/retry without blocking local browsing or valid deterministic gameplay.

## 11. Future themes from Hub

Build the token boundary now; defer the marketplace/distribution workflow.

A theme pack should be **versioned declarative data plus validated assets**, not arbitrary CSS or JavaScript. Supported roles can include approved semantic palette values, bounded spacing/radii/density, licensed local font assets, icon/ornament assets, and selected sound accents.

- Validate format, allowed roles, size limits, asset types, and compatibility.
- Use curated/validated assets; no untrusted executable SVG, arbitrary network URLs, script injection, or selectors that can hide security/gameplay controls.
- Theme appearance may change; rules, message permissions, panel semantics, and action availability may not.
- Accessibility preferences override theme motion, low contrast, small text, and transparency.
- Contrast-check supplied text/surface pairs and offer a safe built-in fallback.
- Resolve and install assets locally; boot/play must not depend on Hub availability.
- Preview, Apply, Cancel, and Reset are distinct operations.
- Scope a game theme so it does not unexpectedly restyle Hub, settings, or unrelated application surfaces.
- Explicit theme selection works independently of OS preference; system theme is a separate choice.

This gives future creators meaningful control without giving a skin the power to restructure or execute the application.

## 12. Accessibility, input, and performance

### Input and focus

One input coordinator chooses the active scope: world, conversation composer, management, targeting, or modal. Text inputs, IME composition, and content-editable regions must not trigger movement, inventory, or numbered hotbar shortcuts. Remapped bindings supply visible labels; do not hardcode shortcut hints.

Escape unwinds the most local state: autocomplete → transient menu → targeting → management → pause as applicable. Returning restores the triggering focus target. IME composition must not accidentally submit Enter. Keyboard navigation and touch both need complete paths; controller support, if included, requires its own focus-navigation design rather than pretending keyboard events are sufficient.

Use the shared native-dialog-based Modal for true modal workflows. Persistent rails are not `aria-modal` dialogs. Use native/nonmodal popover patterns for transient menus where supported; preserve working fallback behavior on supported Tauri WebViews. Avoid relying on newly introduced browser attributes without checking the support policy.

### Accessibility criteria

- Normal text contrast at least 4.5:1; relevant large text/non-text controls at least 3:1.
- Outcomes, HP danger, and relationships are not color-only.
- Visible focus, logical DOM order, accessible names, and touch-operable menus.
- Large-text/reflow behavior with no clipped composer or unreachable controls.
- Controlled announcements for new messages, finished rolls, errors, and turn changes.
- Structured noncanvas access to actor, target, action, and result information.
- Reduced-motion and higher-contrast coverage across all presentation modes.

### Performance criteria

- Stable list keys; do not generate new IDs while deriving a card's display state.
- Precompute row view data outside templates; remove repeated `.find()`, `.filter()`, and log parsing from render loops.
- Page older history and bound mounted content as needed. Introduce virtualization only after measuring and preserving find/search, focus, selection, and screen-reader behavior.
- Reserve attachment dimensions to avoid scroll jumps; defer off-screen image decoding.
- Coalesce streaming updates; do not reparse the entire transcript for each token.
- Mount heavy inspectors only when needed without creating import waterfalls for ordinary services.
- Scene resize/occlusion goes through the engine integration boundary, not a new Svelte-owned ticker.
- Avoid expensive full-viewport blur over animated world content.

## 13. Delivery sequence

Deliver vertical slices that prove real journeys. Do not reskin every legacy overlay first and consolidate afterward.

### Phase 1 — prove the design in a fixture-driven sandbox

- Token/typography sample, opaque reading panel, shared control states.
- Scene + Chronicle + one management inspector at wide, compact, and large-text sizes.
- One NPC exchange including recipient selection, streaming, failure, and inline check.
- One combat turn using the same Chronicle and action surface.
- Validate the right-rail versus focused-reading experience with actual narrative lengths and images.

**Exit:** stakeholders choose the direction from rendered interactions, not just a palette. Proposed serif role and shell defaults are approved before broad migration.

### Phase 2 — production shell and inline dice

- Consolidate duplicate combat presentation and lifecycle ownership.
- Introduce shell/focus/navigation policy and migrate the HUD.
- Replace screen-covering dice with persistent inline check cards.
- Keep existing domain mechanics behind adapters.
- Preserve loading, save-error, transition, and game-over behavior.

**Exit:** one active combat action surface; one check commits once; keyboard and layout behavior remain correct.

### Phase 3 — unified conversation workflows

- Bring NPC, Party, and DM contexts through the shared composer/renderer, preserving permission boundaries.
- Preserve scoped drafts, cancellation, retry, slash commands, and scroll state.
- Expose Rephrase, Continue, image variations, and TTS with distinct semantics.
- Add robust interrupted-operation recovery and operation provenance.

**Exit:** switching contexts cannot misroute text or late responses; presentation regeneration cannot replay consequences.

### Phase 4 — management consolidation

- Character/Inventory/Journal/Party/World hosts.
- Reuse actor/item inspectors, comparisons, quest detail, existing notes, and relationship capabilities.
- Add source-linked summaries and media collections where data supports them.
- Clearly separate new gameplay systems requiring additional domain work from UI consolidation.

**Exit:** loot-to-equip, quest-to-note, and companion-to-sheet journeys are short and preserve return state.

### Phase 5 — combat depth and creator polish

- Supported ruleset action/resource/spell controls, targeting, conditions, and clear intent previews.
- Encounter summary and media/history integration.
- Theme validation/import when the built-in system is stable.
- Further shortcuts, compact density, and measured performance optimization.

Every phase includes tests and accessibility work. Existing persisted saves must remain loadable; new record shapes need schema versions/migrations and legacy rendering fallbacks. Avoid dual-writing side effects through old and new presentation paths during rollout.

## 14. Verification plan

### Essential journeys

1. New player enters an NPC conversation, knows who will hear the message, sends text, performs an inline check, and understands the result.
2. Player opens inventory mid-conversation, compares/equips an item, and returns to the same draft and scroll position.
3. Player switches NPC → Party → DM while a response is pending; the late response lands only in its original context.
4. Player reads older messages while images/streaming updates arrive; the reading position remains stable.
5. Player completes a combat turn using an action/spell/item, sees the exact cost/result, and ends the turn through one control.
6. Rapid double activation, retry, remount, and restart cannot duplicate a roll, reward, or resource expenditure.
7. Rephrase preserves world facts and consequences; an image variation cannot change dialogue state.
8. AI/TTS/image generation fails or is unavailable; saved data and drafts remain usable, with clear recovery actions.
9. An interrupted operation is restored as completed/pending/failed accurately after restart—not silently rerolled or fabricated as complete.
10. Large text, keyboard-only use, IME entry, touch, reduced motion, and high contrast remain functional.
11. Theme selection under a light OS preference still applies an explicit dark theme; invalid packs safely fall back.
12. Long campaign history and large galleries do not make typing, scene interaction, or opening an inspector unresponsive.

### Test layers

- **Pure domain/unit tests:** availability, modifiers, command validation, idempotency, projections, and ruleset-sensitive labels using deterministic fixtures.
- **Real Svelte Browser Mode:** ViewModel reactivity, focus return, composer state, mounting/lifecycle, resizing, and cancellation/stale responses. Bun rune polyfills alone cannot prove reactive behavior.
- **Repository tests:** real in-memory libSQL for operation/record atomicity, migrations, source links, and resume behavior.
- **Playwright with page objects:** cross-surface journeys above, real keyboard/IME-sensitive behavior, responsive navigation, and reload restoration.
- **Visual tests:** desktop/compact layouts, large text, light/dark/high contrast, empty/loading/error/long-content states, and every dice phase. AI visual assessment supplements, never replaces, behavioral assertions.

Use feature-local typed fixtures and dev sandboxes without depending on live model output. Keep engine behavior and persistence integration tests in addition to UI-only fixtures.

During implementation, detect affected Moon projects and run the repository's fix/typecheck/build/test validation flow. No runtime tests were run for this design-only document.

## 15. Decisions to confirm before production implementation

Recommended defaults are provided above; these are decision points, not hidden commitments:

- Desktop side Chronicle plus Focus conversation, rather than a permanently cinematic bottom box.
- Inter retained for UI, Source Serif 4 proposed for sparse display headings.
- Supported ruleset/edition and which mechanics are real versus future scope.
- Which NPC/party information is intentionally visible, including thoughts, numeric relationships, DCs, and stakes.
- Pause/time behavior while talking, targeting, and managing inventory.
- First release device/input scope, especially controller support and mobile combat.

**First deliverable recommendation:** one polished sandbox showing an NPC conversation → inline roll → inventory inspection → combat turn. Prove those transitions before expanding the feature list or building Hub theme distribution.
