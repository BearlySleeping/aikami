# Contract C-081: Character Creation Structural Extraction Pipeline

## Metadata
- **Source:** Architectural Consolidation Review
- **Target:** PWA Character Creation Workflow
- **Priority:** P1
- **Dependencies:** C-078, C-080
- **Status:** not_started
- **Contract Version:** 1.0.0

## Overview
This contract refactors the Dev Character Creation Sandbox (and associated UI controllers) to use the new `aiTextIntelligenceService.extractStructure()` method. By replacing manual JSON parsing or raw text completions with TypeBox schemas, we guarantee that the final character persona—including D&D stats, background, and physical description—matches our strict game engine requirements.

## Design Reference
- The TypeBox schema definitions established in `@aikami/shared/schemas` (if available) or local TypeBox declarations.
- The `aiTextIntelligenceService.extractStructure` pattern introduced in C-080.

## Architecture Directives
- **Schema Definition**: Define a strict TypeBox schema representing the exact payload expected from the DM at the end of the character creation chat (Name, STR/DEX/CON/INT/WIS/CHA, Background, Appearance).
- **ViewModel Refactor**: Update the character creation view-model to call `aiTextIntelligenceService.extractStructure()` instead of using a standard chat or manual fetch when the user clicks "Generate Character".
- **Prompt Adjustments**: Ensure the system prompt for character generation specifically instructs the LLM to output the exact schema format requested by the TypeBox compiler.

## State & Data Models
    
    // Conceptual TypeBox Schema for the Extraction
    const CharacterExtractionSchema = Type.Object({
        name: Type.String(),
        background: Type.String(),
        appearance: Type.Object({
            physicalDescription: Type.String(),
            clothing: Type.String()
        }),
        abilityScores: Type.Object({
            strength: Type.Integer(),
            dexterity: Type.Integer(),
            constitution: Type.Integer(),
            intelligence: Type.Integer(),
            wisdom: Type.Integer(),
            charisma: Type.Integer()
        })
    }, { additionalProperties: false });

## Acceptance Criteria

### AC-1: Strict Schema Definition
- **Given:** A user finishes chatting with the DM to build their character.
- **When:** The extraction phase begins.
- **Then:** The system uses a strict TypeBox schema (`CharacterExtractionSchema`) compiled directly into the JSON schema format required by the unified intelligence service.
- **Test Hook:** Unit tests verify that `CharacterExtractionSchema` compiles to valid JSON schema with `additionalProperties: false`.

### AC-2: ViewModel Integration
- **Given:** The `CharacterViewModel` is in the `GENERATING` phase.
- **When:** Generating the final character persona.
- **Then:** It invokes `aiTextIntelligenceService.extractStructure()`, passing the entire chat history and the schema, and automatically binds the returned typed object to the local `$state` persona without manual JSON parsing.
- **Test Hook:** The view model's generate method returns a valid typed `PersonaData` object and safely transitions to the `TWEAK` phase.

### AC-3: Fallback and Error Handling
- **Given:** The LLM fails to return a strictly compliant JSON structure or times out.
- **When:** The intelligence service throws an extraction error.
- **Then:** The view model catches the error, drops back to the `CHAT` phase, and displays a user-friendly error message indicating the extraction failed.

## Implementation Notes
1. Import `Type` from `@sinclair/typebox` in the character creation view-model or prompt definition file.
2. Build `CharacterExtractionSchema` matching our actual `PersonaData` game state requirements.
3. Replace the existing generation logic in `CharacterViewModel.generateCharacter()` with `aiTextIntelligenceService.extractStructure()`.
4. Ensure the abort controller properly handles user cancellations during this structured extraction step.

## Edge Cases & Gotchas
- **Model Support:** Not all local Ollama models support strict JSON schema adherence perfectly. Ensure the system prompt heavily reinforces the JSON shape as a backup for weaker fallback models.
- **Mapping:** The returned object must be mapped cleanly into the reactive `$state` persona so the UI instantly updates for the TWEAK phase.
