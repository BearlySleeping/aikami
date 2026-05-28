# Todo & Future Features

This document outlines some of the planned features and improvements for the Aikami project. This is a living document and will evolve as the project grows.

## Short-Term Goals

- [ ] **Character Creation Flow:** Implement the full character creation and customization flow in the PWA.
- [x] **AI Dialogue System v1:** Integrate the first version of the AI-powered dialogue system with a few key NPCs. (In Progress)
- [ ] **Real-time Chat:** Add a real-time chat feature to the PWA for players to communicate.
- [ ] Architecture: Integrate OpenViking for hierarchical lore retrieval.
- [ ] DevOps: Add `rtk bun moon run services:viking` to the dev workflow.
- [ ] Testing: Setup PromptFoo for NPC personality regression testing.

## PWA Next Phase Tasks

- [ ] **Advanced Context Management:** Implement a LorebookService to inject relevant world data into the AI's context based on activation keywords.
- [ ] **Chat Interaction Overhaul:** Add Regenerate/Swipe options, Message Editing, and Branching capabilities.
- [ ] **Character Expressions & Visuals:** Enhance CharacterImporter for multiple expressions and update ChatView to dynamically switch avatars.
- [ ] **Author's Notes & Prompt Orchestration:** Create a template system for formatting character data and injecting high-priority behavioral instructions.
- [ ] **RPG Mechanics Integration:** Implement Stat Sheets, chat commands (e.g., /roll d20 + 3), and NPC skill check challenges.
- [ ] **UI/UX Polishing & PWA Features:** Add Svelte transitions, Dark/Light modes, custom color themes, and improve offline capabilities.
- [ ] **Enhanced Onboarding:** Create a guided walkthrough for first-time users and a library of Starter Characters.

## Medium-Term Goals

- [ ] **Basic Inventory System:** Design and implement a basic inventory system for the Godot client and backend.
- [ ] **Combat System:** Develop the core turn-based combat mechanics.
- [ ] **Quest System:** Build a flexible quest system that can support both handcrafted and AI-generated quests.
- [ ] **Leveling and Skill System:** Implement character leveling, skills, and abilities.
- [ ] **World Persistence:** Ensure the game world state is properly persisted and synchronized between the client and server.

## Long-Term Vision

- [ ] **Generative Quests:** Explore using AI to generate dynamic and emergent quests based on player actions and world events.
- [ ] **Procedural World Generation:** Investigate using AI to procedurally generate parts of the game world.
- [ ] **Multiplayer Interaction:** Add features to allow players to interact with each other in the game world.
- [ ] **Mobile App:** Package the PWA as a native mobile app for iOS and Android.

## How to Contribute

Have an idea for a new feature? Want to help tackle one of the items on this list? We'd love your help! Please see our [**Contributing Guide**](../CONTRIBUTING.md) to get started.
