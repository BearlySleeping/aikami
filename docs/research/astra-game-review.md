# Executive verdict

**Aikami is not falling behind because it uses PixiJS, LPC, or a custom engine. It is falling behind its own ambition because the strongest systems are not consistently reaching the player as meaningful experiences.**

You have built substantial foundations. But right now, Aikami’s breadth is much greater than its depth:

- More ways to supply AI than reasons to care about an NPC.
- More character configuration than demonstrated character differentiation.
- More narrative infrastructure than visible, persistent consequences.
- More definitions of “implemented” than convincing evidence of “fun.”

That is fixable. **I would not restart, change engines, or build another generalized AI layer.**

My recommendation is:

> **Make Aikami a single-player, character-driven “living village” RPG: a small, beautiful, replayable place where you can speak freely, characters pursue conflicting goals, and your actions produce consequences you can see and revisit.**

Think **BG3’s reactivity and companion appeal at the scale of a compact tabletop adventure**, not BG3’s content volume with everything procedurally generated.

And yes: **generated sprite sheets are worth testing now**—as a curated content-production workflow, not yet as an unquestioned replacement for your modular equipment system.

---

## What I examined

I read the engine/client production paths, campaign content, strategy and architecture documents, relevant contracts, and your three reference READMEs. I also inspected Marinara’s game-mode documentation and current PixelLab documentation.

I ran the local client and inspected:

- Start menu.
- Provider onboarding.
- Character creation.
- Starter-character review.
- A direct `/game` diagnostic boot.

**Limitations:** I did not complete an adventure, benchmark AI models, or generate/test sprite sheets. The direct game boot used its default/transient setup, not a completed normal onboarding journey. The code findings below are source findings; visual observations are from that local browser session.

No code was changed.

# 1. The most important findings

## 1.1 Your playable content does not yet demonstrate your differentiator

The current [`content/packs/emberwatch/manifest.json`](content/packs/emberwatch/manifest.json) contains:

- Three maps.
- Three NPCs.
- One quest.
- One encounter.
- One declared ending.
- No NPC configured as a recruitable companion.

The premise is straightforward: get the Ward Wand from Rollo and return it to Thalia.

That is a reasonable integration fixture. It is not yet a strong demonstration of a living world.

**The problem is not that the adventure is small. It is that its dramatic possibility space is small.**

There is currently little in that authored pack to make me wonder:

- Who is lying?
- Whose interests conflict?
- What changes if I take too long?
- What does helping one person cost another?
- What will my companion think?
- What would I do differently next run?

AI can paraphrase a fetch quest indefinitely without making it meaningfully dynamic.

**Your next content investment should be a dilemma, not more geography.**

---

## 1.2 The normal NPC interaction bypasses much of the richer AI infrastructure

There is a significant gap between your GM systems and the main dialogue path.

The production dialogue ViewModel calls `npcDialogueService.analyzeIntent()`. That service constructs a persona along the lines of:

> “You are [name], a character in a fantasy world.”

See [`npc_dialogue_service.svelte.ts:1597`](apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts#L1597).

It does receive recent conversation and game-state facts. Relationship/faction facts can reach it through `buildGameStateFacts()`, so it would be inaccurate to say it receives _no_ relationship context.

However:

- It does not use the richer `gmPromptService` assembler.
- It does not query the memory-retrieval service.
- The content-pack NPC schema does not provide a substantial personality/agenda/knowledge definition.
- Its roll-resolution prompt does not include the supplied conversation and game-state facts in the way the intent prompt does.

**You have built a richer brain elsewhere, while the interaction players primarily encounter receives a much thinner character definition.**

Before improving model quality, fix what the model actually knows.

A name plus “fantasy NPC” is not a character.

---

## 1.3 Character creation promises mechanical identity that dialogue does not consistently honor

This is especially important:

```ts
const modValue = 0; // TODO: read from character sheet when available
```

That is in the free-text skill-check path at [`dialogue_overlay_view_model.svelte.ts:1309`](apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts#L1309).

The caller also omits `playerContext` in that path, and the service supplies a default “Level 1 Fighter.”

You ask the player to choose a class, ability scores, background, equipment, and personality. But a central expression of those choices—attempting something through dialogue—does not consistently use them.

**That is more damaging than an ugly button. It teaches the player that their character sheet might be decorative.**

Fixing this would be one of my first changes.

---

## 1.4 “Group chat” and “autonomy” are ahead of their production integration

I found `selectGroupParticipants()` and `generateMultiNpcResponses()` implementations and tests, but no production callers for those methods.

Likewise:

- The autonomous-message poller is started in a dev sandbox.
- Its known-NPC discovery uses world-generation output rather than the authored scene cast.
- The narrative director’s timed startup appears in its sandbox.
- The production “Talk to Party” overlay actually addresses one companion through the NPC dialogue service.

Relevant implementation: [`autonomous_message_service.svelte.ts`](apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts).

This does **not** mean the code is useless. It means:

> “Can produce multiple NPC replies in a unit test” is not the same milestone as “two companions disagree about my decision during the adventure.”

Do not build another group-chat system. Connect and simplify the existing pieces around one real scene.

---

## 1.5 The memory implementation needs verification before more memory features

In [`local_embedding_backend.ts:174`](apps/frontend/client/src/lib/services/memory/local_embedding_backend.ts#L174), when stored entries have embeddings, querying takes a **keyword-overlap** branch.

In other words, the normal indexed-data case is not using the semantic cosine-similarity path described by the service.

I also found no production callers for the singleton’s initialization/background-index-on-load methods in the inspected client.

The practical conclusion is not “build better RAG.”

It is:

1. Make a small set of campaign facts persist.
2. Retrieve the right facts for the right NPC.
3. Demonstrate recall after leaving the conversation and reloading.
4. Only then decide whether semantic retrieval improves anything.

For a five-character village, **a correct fact table can outperform an impressive but disconnected memory architecture.**

---

## 1.6 Your “AI proposes, rules decide” principle is not consistently enforced

The principle is right. The implementation has multiple authority paths.

Examples:

- The pure `resolveCommand()` rules kernel has no production engine/client callers that I found; combat and relationship calculations happen elsewhere.
- The free-text roll-resolution path directly applies some inventory and flag deltas.
- `trust_change` and `relationship_update` deltas are accepted in `_validateAndApplyDeltas()` without that method actually updating relationship state.
- Custom combat actions pass model-proposed advantage and bonus damage into the engine.

Schemas and numeric bounds are useful, but they do not answer:

> Is this NPC entitled to give this item? Has this reward already been granted? Does this action deserve advantage? Does the claimed event actually happen?

There is also a fundamental ordering issue: **some paths speak first and extract/validate consequences afterward.** If the NPC says “Here, take the wand,” and the mutation fails, the player experiences a broken promise from the game itself.

Do not solve this with a sweeping engine rewrite. Establish one authoritative path for the next interaction you ship, then expand it incrementally.

---

## 1.7 Chat branching currently means something different from campaign branching

[`createBranch()` and `switchBranch()`](apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts#L1624) copy and restore message arrays.

They do not restore the corresponding inventory, quest, relationship, world, or RNG state.

That is understandable in a chat application. It is dangerous in a consequential RPG.

If I threaten Rollo, obtain the wand, and then switch to the conversation branch where I was polite, what world am I now in?

For the game-facing experience, choose one of these explicitly:

- **Rephrase:** changes presentation, not outcomes.
- **Rewind:** restores the whole campaign checkpoint.
- **Fork campaign:** creates a new world-state branch.

Until full rewind exists, I would hide historical edit/delete/branch controls from normal play rather than imply they undo consequences.

This is an example of a reference-tool feature that does not transfer cleanly.

---

## 1.8 The release gate is not strong enough to support its own name

[`release_gate.spec.ts`](apps/e2e/tests/client/release_gate.spec.ts) has several weak signals:

- Its start-button matcher does not match the current “New Adventure” label.
- Combat is exercised only `if (inCombat)`.
- The “HP preserved” assertion checks that HP is positive, not that it is preserved.
- Parts of the journey conditionally skip assertions when UI is absent.

I did not run that suite, so I am not reporting a measured pass/fail result.

But from the source alone, it does not rigorously prove the adventure described in its header.

**Your most valuable testing improvement is not another testing framework. It is one uncompromising production journey with exact state assertions.**

# 2. What Aikami should be—and who it should serve

## Recommended initial audience

**Solo roleplayers who want more structure and consequence than chatbot roleplay, but more conversational freedom than a conventional RPG.**

They might already enjoy:

- Solo tabletop RPGs.
- BG3 companion interactions.
- Narrative-heavy RPGs.
- SillyTavern/Risu-style character roleplay.
- Small systemic games where characters remember your actions.

Their central desire is not “I want twelve model providers.”

It is:

> “I want to inhabit a character in a world that takes my choices seriously.”

Some will be technically comfortable. That makes them suitable early testers. But technical comfort should be a recruitment convenience, not the product’s core appeal.

### Not your first audience

| Audience                         | Why not initially                                                            |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Mainstream BG3 players generally | Expect enormous production value, content depth, and reliability.            |
| Every local-AI enthusiast        | Many enjoy configuring models more than playing campaigns.                   |
| Mobile-first casual players      | Different input, readability, session, and distribution requirements.        |
| Game creators broadly            | Need mature authoring tools, documentation, compatibility, and distribution. |
| Everyone who likes AI            | Not a useful design target.                                                  |

**Recruit people because they want the adventure, not merely because they admire the stack.**

---

## A sharper product promise

I would replace “fully dynamic BG3” as the operational vision with:

> **Aikami is a replayable RPG where you can speak freely, companions have their own agendas, and the world remembers what you actually did.**

Three pillars:

1. **Freedom of expression.**
2. **Characters with conflicting interests.**
3. **Persistent, visible consequences.**

Every substantial feature should strengthen at least one.

“Supports another deployment target” does not, unless it removes an observed blocker for those players.

---

## Distribution: pick a supported experience, not necessarily one code target

Your cross-platform work was not inherently a mistake. Treating every route as an equally important product promise is the problem.

My recommendation:

| Surface                             | Near-term role                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| **Tauri desktop**                   | Primary long-term player experience.                                                        |
| **One reference OS/build**          | The release path you actually verify every time; likely Windows for the initial RPG cohort. |
| **Desktop browser + BYOK**          | Easy evaluation/playtest surface using the same game.                                       |
| **Existing local model connection** | Supported enthusiast path.                                                                  |
| **Managed local installation**      | Expand only after the lifecycle is genuinely trustworthy.                                   |
| **Docker**                          | Advanced backend/server deployment, not the default player onboarding.                      |
| **Mobile**                          | Best-effort secondary access, not a release-blocking promise yet.                           |

For the next playtests, use whichever existing desktop-sized path is currently most reliable. **Do not wait for a perfect installer to test whether the game is interesting.**

Your C-481–C-484 work addresses real configuration and lifecycle problems. I would keep necessary correctness/security repairs, but not make completion of the entire settings programme a prerequisite for gameplay work.

Also: local storage, local inference, first-time downloads, and offline-ready content are separate promises. Say clearly:

> “After downloading this adventure and a local model, you can play offline.”

Do not imply that a fresh browser with no assets or model can do everything without a network.

# 3. The next game: deepen Emberwatch rather than replace it

## Give the wand a moral problem

Here is a possible direction—not an approved rewrite of your story.

The ward is failing. Thalia says Rollo stole its repair artifact.

But:

- Rollo claims the ward protects the village by diverting danger elsewhere.
- Mara has evidence that somebody profits from keeping the emergency unresolved.
- Your companion has a personal connection to the people outside the ward.
- Thalia is not a cartoon villain: she is protecting people she knows at an unacceptable cost.

Now the same small map supports:

- Investigation.
- Negotiation.
- Loyalty conflicts.
- Threats.
- Deception.
- Theft.
- Combat.
- Compromise.

The key is that these are **different state trajectories**, not different prose routes to the same reward.

### A compelling first 20–30 minutes

1. Arrive during a visible ward malfunction.
2. Meet one memorable companion quickly.
3. Receive two incompatible accounts of the situation.
4. Find evidence in the physical world.
5. Attempt a plan through dialogue or a contextual action.
6. See someone react against their own interests—or refuse.
7. Resolve the crisis.
8. Return to a visibly changed village.
9. Save and later encounter a callback to your decision.

The last two steps are essential.

**The proof of a living world is often what happens after the quest.**

---

## Make replay variation causal, not cosmetic

Do not generate a new continent first.

Keep the geography and core cast recognizable. Vary a bounded set of starting conditions:

- Who currently owes whom.
- Which piece of evidence is missing.
- What Rollo wants.
- Which faction has leverage.
- How close the ward is to failure.
- Which companion has a personal stake.

Sample the hidden truth once at campaign creation. Derive clues and behavior from that same truth.

Do not let different NPC generations independently invent contradictory answers to the mystery.

Most importantly:

> **Make the player’s decisions responsible for what becomes unique. Randomness should create the situation, not substitute for agency.**

# 4. Mechanics to prioritize

## First: social leverage

This is more distinctive than adding more spells.

Support a small number of grounded actions:

- Ask.
- Offer.
- Promise.
- Threaten.
- Present evidence.
- Lie.

Free text should map onto these possibilities without forcing players to memorize commands.

Example:

> “I show him Mara’s ledger and promise not to tell the guard.”

That can resolve into:

- Evidence presented.
- A specific promise recorded.
- A negotiation whose difficulty depends on known facts.
- A real change in Rollo’s willingness to cooperate.

A generic charisma roll is less interesting than understanding **what this person needs**.

### Dice should resolve uncertainty, not permission to participate

- Do not roll for ordinary conversation.
- Do not let eloquent prompting manufacture arbitrary bonuses.
- Show the stakes before committing.
- Apply actual character modifiers.
- Make failure change the situation rather than merely demand another roll.

---

## Second: one excellent companion

Not a roster of interchangeable followers.

Give one companion:

- A desire.
- A fear.
- A belief they might revise.
- A relationship with another NPC.
- One boundary they will not casually cross.
- One moment where they act without being asked.

Then make their reactions depend on witnessed events.

“I disapprove: −5” is bookkeeping.

> “You promised him safety. I heard you.”

That is a character.

You already have party, approval, dialogue, and persistence scaffolding. Use it to deliver one scene people remember.

---

## Third: bounded world progression

A living world does not require an LLM continuously thinking for every NPC.

Use deterministic schedules and small state machines for ordinary activity. Ask AI for language and occasional bounded proposals.

For the initial adventure, world time should advance on clear actions:

- Travel.
- Rest.
- Finish a significant interaction.
- Spend a turn on a task.

**Do not make danger advance because the player reads slowly or their local model generates slowly.**

NPCs can remain visually active while consequential simulation pauses.

A world that changes unpredictably during a ten-second inference delay will feel unfair, not alive.

---

## Fourth: tactical-lite combat

Your existing combat machinery is broad enough to support a focused encounter. I would not expand the class catalogue yet.

Make one encounter interesting through a few comprehensible interactions:

- Reposition.
- Attack.
- Defend.
- Interact with an object.
- Negotiate or surrender.

A table used as cover, a threatened witness, or an unstable ward can create more meaningful tactics than several additional attack names.

If spatial combat remains expensive to present well, use a small readable tactical/token presentation. You do not need to reproduce BG3’s tactical surface immediately.

# 5. Architecture: make the story and the world agree

The architecture should support this sequence:

```text
Player intention
    ↓
Grounded interpretation using current facts and legal actions
    ↓
Rules validate targets, resources, permissions, stakes
    ↓
Player confirms consequential action / rolls if needed
    ↓
State change commits once
    ↓
Narration, animation, journal, memories reflect that result
```

Conversation with no mechanical consequence can stream freely.

For consequential actions, avoid confidently narrating success before validation.

## Build around committed events

For example:

```text
PromiseMade
EvidencePresented
ItemTransferred
ThreatWitnessed
QuestResolved
RelationshipChanged
```

These should drive:

- Journal entries.
- NPC knowledge.
- Relationship updates.
- Companion reactions.
- Save data.
- Later GM context.

This need not become a grand event-sourcing migration. Extend the existing local state/save architecture with a narrowly scoped committed-event record for the slice.

### Separate three things

| Kind                 | Example                                   |
| -------------------- | ----------------------------------------- |
| **World fact**       | Rollo possesses the wand.                 |
| **Character belief** | Thalia believes Rollo intends to sell it. |
| **Dialogue claim**   | Rollo says he never touched it.           |

If all three become interchangeable “memory,” you cannot build reliable deception, investigation, or secrets.

Likewise, an NPC should not know an event merely because it exists in the campaign log. They need to witness it, hear about it, or infer it.

**“Who knows what?” is more important to this game than “how many tokens can we retrieve?”**

## Keep AI work bounded

For the slice:

- One primary scene/NPC generation path.
- Deterministic mechanics.
- No mandatory agent committee.
- Event-triggered director work, not constant generation for its own sake.
- Images generated outside the interaction-critical path.
- Voice never blocks progression.

Save accepted generated facts and assets. A seed alone does not reproduce an LLM’s output across model/provider changes.

# 6. UX and visual direction

## What the browser session showed

### The start menu is already reasonably focused

One prominent “New Adventure” action, quiet settings, optional sign-in.

Preserve that hierarchy.

But the abstract gradient/grid backdrop could belong to an AI utility. It does little to establish the world.

**One strong scene of Emberwatch would communicate more than another layer of interface decoration.**

### Onboarding immediately becomes infrastructure

“New Adventure” led to Text / Image / Voice tabs, then:

- Provider.
- API key.
- Model.
- Fetch.
- Connection label.
- Advanced generation parameters.

That is understandable to you. It is not an adventure.

The default flow should describe the player outcome:

- “Use an AI service.”
- “Connect a local model I already run.”
- Later: “Install local AI,” only where actually supported and verified.

Optional artwork and read-aloud should not compete with the required step.

### The fast character path is visually subordinate

The AI chat occupies the top of character creation. Presets sit below it.

Selecting Thaldrin opened a long character-sheet form with:

- A missing portrait placeholder.
- A small LPC preview.
- Editable HP, AC, speed, class, alignment, proficiencies, and more.

**A preset should mean “this character is ready,” not “please finish filling out this form.”**

Recommended default:

1. Three illustrated heroes.
2. Name.
3. One motivating choice.
4. Enter the world.
5. “Customize everything” as an explicit secondary path.

Character generation can remain a feature. It should not be the fastest-looking route that actually takes the longest.

---

## Choose an art direction, not just a theme

Your purple/dark UI palette is not an art direction.

Art direction also specifies:

- Character proportions.
- Camera angle.
- Pixel density.
- Lighting.
- Palette.
- Portrait style.
- Environmental detail.
- UI density.
- Animation exaggeration.

My preference would be **illustrated dark-fantasy portraits plus a restrained, readable miniature world**.

That combination can work beautifully. What cannot work is an accidental mixture of placeholder portraits, unrelated sprites, inconsistent equipment, and generic UI.

For the first release, commission or curate one cohesive visual set:

- Three starter heroes.
- The core NPC cast.
- One environment kit.
- Essential item icons.
- A few expression variants.

If budget permits, a focused pixel artist/art-director engagement could have more visible impact than another month of generalized systems work.

---

## Quick wins I would actually prioritize

| Change                                                   | Why it matters                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Put starter heroes above AI chat                         | Shortens the route to play.                                             |
| Make preset confirmation compact                         | Honors the promise of a ready-made character.                           |
| Supply portraits for the shipped cast                    | Removes a highly visible placeholder state.                             |
| Hide empty hotbar slots until useful                     | Avoids presenting unfinished-looking controls.                          |
| Use “Character,” “Adventure,” “Voice” in player UI       | Reduces tool-oriented terminology such as persona, connection, and TTS. |
| Show action stakes and actual modifiers                  | Makes character choices trustworthy.                                    |
| Surface persistent consequences with restrained feedback | Makes system depth perceptible.                                         |
| Preserve drafts and distinguish retry from reroll        | Prevents frustration and accidental state changes.                      |
| Put transcript editing/branching under advanced tools    | Protects the meaning of campaign history.                               |
| Tune camera framing before replacing all art             | Scale and composition strongly affect perceived sprite quality.         |

The direct `/game` diagnostic showed very enlarged tile repetition, an oversized portrait-like default character, and substantial empty background near the map edge. That is not a complete art assessment of a normally configured campaign, but it is enough to justify a focused camera/default-asset review.

Do not judge LPC solely through a broken or poorly framed presentation.

# 7. Can image generation replace LPC?

## Short answer

**For complete characters and curated animation sheets: yes, it is advanced enough to investigate seriously.**

**For arbitrary, runtime-generated, perfectly interchangeable LPC armor/body/weapon layers: I would not make that a production assumption.**

I checked current specialized tooling rather than relying solely on general image-model impressions.

PixelLab documents:

- Four/eight-direction characters.
- Character animation.
- Reference-guided workflows.
- Skeleton-guided animation.
- Outfit-transfer tools.
- Sprite-sheet export.

Sources: [API reference](https://api.pixellab.ai/v2/llms.txt), [rotation guide](https://www.pixellab.ai/docs/guides/rotating-a-character), [skeleton animation](https://www.pixellab.ai/docs/tools/animate-with-skeleton).

Importantly, its own rotation guide discusses accumulated errors, inconsistent details, and manual correction.

**Those capabilities justify an experiment. They do not prove that your required output quality is solved.**

---

## The difficult part is not arranging rectangles

A generated sprite sheet must maintain:

- Identity across directions.
- Stable silhouette and scale.
- Consistent lighting.
- Correct animation phases.
- Foot contact.
- Stable pivots.
- Clean transparency.
- Consistent weapon handedness.
- Appropriate front/back occlusion.
- Compatibility with the environment’s perspective.

A beautiful contact sheet may still animate badly.

And armor compatibility is a separate, harder problem: every layer must agree about where the same body is in every frame.

---

## Your coordinate-map idea is correct—but use an animation manifest

Support an atlas with:

- Named frame rectangles: `x, y, width, height`.
- Named clips: `idle.down`, `walk.left`, `attack.up`.
- Ordered frame lists.
- Frame durations.
- Loop behavior.
- A stable logical origin, usually near the feet.
- Trim offsets when frames are cropped.
- Explicit fallback behavior for missing clips.

Keep gameplay collision and authoritative hit timing separate from visual frame bounds.

Later, if needed, add:

- Hand/weapon attachment points per frame.
- Front/back equipment passes.
- Cosmetic animation markers.

**One rectangle per animation is insufficient:** an animation is a sequence with timing and alignment.

Your current production LPC loader hardcodes `walk`, and its geometry resolver infers 64/128-pixel cell layouts from image dimensions. See [`game_world.ts:3532`](packages/frontend/engine/src/game_world.ts#L3532) and [`sheet_geometry.ts`](packages/shared/lpc/src/lib/sheet_geometry.ts).

That path is not a generic arbitrary-atlas player yet.

A small atlas import path would be useful regardless of whether the art is human-made or AI-generated.

---

## How I would handle equipment

### Option A: fixed visual outfit, mechanical equipment

A generated character has one coherent outfit. Equipment changes stats and inventory, but not every visible garment.

- Simplest.
- Most reliable visually.
- Weakest paper-doll customization.

Entirely acceptable for an initial narrative RPG if communicated honestly.

### Option B: a few complete outfit states

Generate/author:

- Travel outfit.
- Armored outfit.
- Optional special/story outfit.

Switch among approved whole-character sheets.

This captures much of the visible progression without supporting every combination.

### Option C: modular overlays on a standardized rig

Retain LPC-like compatibility or introduce an equally strict shared rig.

Best for equipment visualization, but this requires disciplined art production. AI can assist; it does not remove the compatibility requirement.

**My recommendation:** keep LPC for customizable player characters; test complete generated/hand-authored sheets for a few NPCs or creatures. Permit both asset types without committing to two entirely separate engines.

---

## Run a bounded art experiment

Do not integrate a new image provider first.

Produce a small batch externally:

- Three core NPCs.
- Four directions.
- Idle and walk.
- One expressive action.
- One outfit variation on one character.

Evaluate them **inside the real map at real gameplay scale**, not only in an image viewer.

Measure:

- How many attempts produce an acceptable character?
- How much manual cleanup is required?
- Does it look good while moving?
- Does the whole cast look like one game?
- Are licenses/provenance acceptable?
- Is the workflow reproducible enough for you to maintain?

Compare against a curated LPC set and, if possible, one artist-made sample.

**Cost per accepted animated character matters more than cost per generated image.**

Until that experiment wins, restrict the shipped LPC catalogue to known-good combinations. Community uploads can be valid assets without automatically being suitable for the default adventure.

# 8. What to borrow from your inspirations

| Reference       | Borrow                                                                                  | Do not inherit by default                                                    |
| --------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Marinara**    | Emphasis on immediate fun, clear character presentation, party interaction, continuity. | Its full feature catalogue, seven-step world setup, or every optional agent. |
| **RisuAI**      | Character portability, expression art, approachable character-centric interaction.      | The assumption that a transcript is the complete game state.                 |
| **SillyTavern** | Extensibility, provider openness, community formats, power-user escape hatches.         | Power-user configuration as the ordinary player experience.                  |

Their lesson is not “ship all these features.”

It is that their central interaction—spending time with characters—is recognizable.

Aikami needs an equally recognizable core:

> **Meet someone, understand what they want, make a choice, and live with what follows.**

Character-card import is useful distribution infrastructure, but imported prose is not automatically a mechanically valid NPC. Keep imported personality/content separate from permission to alter world state.

# 9. Potential pivots

## A. Living-village RPG — recommended

**Best fit for your stated dream.**

Small spatial world, free dialogue, companion relationships, authored dramatic framework, bounded variation.

Main challenge: integration, writing, and consequence design.

## B. Portrait-first RPG with lightweight maps

A lower-rendering-risk version of the same promise:

- Beautiful portraits.
- Illustrated locations.
- Small token/tactical maps where space matters.
- Strong dialogue, relationships, and rules.

This is a credible pivot if rendering consumes too much energy. It is not failure; it reallocates production effort toward your differentiator.

## C. Creator engine / AI campaign toolkit

Potentially a better fit for your infrastructure passion.

But then the customer is a creator, and the product must excel at:

- Authoring.
- Debugging.
- Packaging.
- Compatibility.
- Sharing.
- Documentation.

That is a valid company/project direction. It is **not** a shortcut to making a compelling game; it introduces a different customer and support burden.

I would choose this only if you discover that you genuinely prefer enabling other people to make adventures over directing one yourself.

**Do not implicitly attempt all three.**

# 10. What I would develop next

## First milestone: “One conversation that changes tomorrow”

Use an existing Emberwatch NPC.

The player:

1. Learns something specific.
2. Makes a consequential promise or threat.
3. Resolves it with the real character sheet.
4. Causes a validated state change.
5. Sees an immediate reaction.
6. Leaves.
7. Saves and reloads.
8. Returns to a changed interaction.
9. Has a companion acknowledge what happened.

This single milestone exercises nearly everything that matters.

It should not require world generation, additional providers, multiplayer, music generation, video, or a new asset marketplace.

---

## Then sequence the work like this

### Phase 1 — Restore trust

- Fix character context and skill modifiers.
- Ground the core NPC personalities.
- Make one consequence commit correctly and persist.
- Prevent transcript edits from pretending to rewind the world.
- Replace the weak release journey with exact assertions.

### Phase 2 — Make Emberwatch worth replaying

- Add one companion.
- Add a conflicting motive and discoverable evidence.
- Support several materially different resolutions.
- Show consequences after the ending.
- Introduce a small number of coherent starting-state variations.

### Phase 3 — Make it attractive and comfortable

- Curated cast portraits and sprite combinations.
- Camera and map composition.
- Short preset onboarding.
- Clear action feedback.
- Readable dialogue, keyboard focus, UI scaling, reduced motion.
- Optional voice polish.

### Phase 4 — Test the claim

Watch five target players without coaching.

Ask afterward:

- Who was your favorite character?
- What did you believe was happening?
- Which choice mattered?
- What changed because of you?
- What would you try next time?

Track:

- Time to first meaningful interaction.
- Setup abandonment.
- AI wait time.
- Contradictions and rejected mutations.
- Successful save/resume.
- Whether players actually want another run.

A particularly useful question:

> **“What happened in your run?”**

If the answer is “I configured a model and talked to an NPC,” the differentiator has not landed.

If the answer is “I protected Rollo, but my companion discovered why, and now Thalia won’t trust us,” you have something.

---

# Final recommendation

You do not need to abandon your ambition. You need to reduce the number of things that must work before the ambition becomes visible.

**Keep the infrastructure. Stop making infrastructure breadth the measure of progress.**

For the next development cycle:

- One audience.
- One verified delivery path.
- One small adventure.
- One memorable companion.
- A handful of meaningful verbs.
- Persistent consequences.
- A coherent visual set.

Use AI to expand **how people respond within a believable world**, not to avoid deciding what makes that world interesting.

And on the fear of falling behind:

**AI is rapidly commoditizing prototypes and asset generation. That makes taste, coherence, character, and reliable consequences more valuable—not less.**

The next valuable Aikami demo is not “look how much it can generate.”

It is:

> **“Watch what happens when I break this promise.”**
