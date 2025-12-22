# AiKami: The AI-Powered 2D RPG

**AiKami** is a modern, AI-powered technology stack for creating immersive, top-down 2D RPGs in the spirit of classic Dungeons & Dragons adventures. Developed by **BearlySleeping**, this project aims to redefine the genre by integrating cutting-edge AI to drive dynamic storytelling, character interactions, and world events.

This repository contains the complete monorepo for the AiKami stack, including the web-based Progressive Web App (PWA), the Godot game client, backend services, and all the shared libraries that power the ecosystem.

## Project Overview

AiKami is an ambitious project that combines the creative possibilities of AI with the classic gameplay of 2D RPGs. The project is built on a modern, scalable, and maintainable technology stack, with a clear separation of concerns between the different components.

The project is structured as a monorepo, managed by **Moon** and **Deno**, which allows for a streamlined development workflow and easy code sharing between the different applications and packages.

### Key Features

- **AI-Driven World:** NPCs and in-game events are powered by modern AI, creating a living world that reacts to your choices. The AI is powered by **Google's Genkit**, a robust and extensible AI framework.
- **Cross-Platform PWA:** A **SvelteKit**-based PWA serves as the main hub for players to manage their accounts, characters, and interact with the game world outside of the main game client. The PWA is inspired by [RisuAI](https://github.com/kwaroran/RisuAI).
- **High-Performance Game Client:** The game itself is built with the powerful and open-source **Godot Engine**.
- **Scalable Backend:** Built on **Deno** and a serverless architecture using **Firebase** (Functions, Authentication, Firestore, and Storage), the backend is designed to be scalable, secure, and efficient.
- **Monorepo Structure:** The entire codebase is managed in a single monorepo using **Moon**, making it easy to share code and manage dependencies.
- **CI/CD:** The project has a CI/CD pipeline set up with **GitHub Actions** that only deploys the components that have been changed.

## Architecture

The AiKami ecosystem is composed of several key components that work together to deliver the full experience.

- **Frontend Applications:**
  - **PWA (SvelteKit):** The main user-facing application for account and character management.
  - **Static Sites (Astro):** The landing page and documentation sites.
  - **Game Client (Godot):** The 2D top-down RPG.
- **Backend Services:**
  - **Firebase:** The backend is built on a serverless architecture using Firebase.
- **AI Integration:**
  - **Genkit:** Google's Genkit is used as the AI framework.

For a more detailed explanation of the architecture, please refer to the [**Architecture Overview**](./docs/ARCHITECTURE.md).

## Getting Started

Ready to contribute? We'd love to have you! Please check out our [**Contributing Guide**](./CONTRIBUTING.md) for instructions on how to set up your development environment and make your first contribution.

For a deeper dive into the project's architecture, stack, and coding standards, please explore our [**documentation**](./docs).

## TODO

The project is still under development, and there are many things to do. Here is a high-level overview of the tasks that need to be done:

- **Documentation:**
  - Create a new `CODING_STANDARDS.md` file in the `docs` directory.
  - Write detailed documentation for each package and app.
  - Document the CI/CD pipeline.
  - Document the Godot client's interaction with the Firebase backend.
- **Testing:**
  - Define a unit testing strategy.
  - Plan for Playwright tests for the PWA.
- **Development:**
  - **Landing Page:**
    - ...
  - **Backend:**
    - ...
  - **Docs Page:**
    - ...
  - **PWA:**
    - ...
  - **Godot:**
    - ...

For a more detailed list of tasks, please refer to the [**TODO.md**](./TODO.md) file.

---

**BearlySleeping** - _Dreaming big, one line of code at a time._