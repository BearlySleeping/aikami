# Architecture Overview

This document provides a high-level overview of the technical architecture of the Aikami project.

## Guiding Principles

-   **Scalability:** The architecture is designed to scale with a growing user base, leveraging serverless technologies and a modern frontend stack.
-   **Maintainability:** By using a monorepo and organizing code into discrete packages, we aim to keep the codebase clean, maintainable, and easy to contribute to.
-   **Performance:** We prioritize performance at every layer of the stack, from the database to the game client.

## System Components

The Aikami ecosystem is composed of several key components that work together to deliver the full experience.

![Aikami Architecture Diagram](https://via.placeholder.com/800x450.png?text=Architecture+Diagram+Placeholder)
*(TODO: Create architecture diagram)*

### 1. Frontend Applications

-   **PWA (SvelteKit):** The main user-facing application. It's a Progressive Web App built with SvelteKit, allowing for a fast, native-like experience on both web and mobile. It handles user authentication, character management, and provides a rich interface for interacting with the game's world and community.
-   **Static Sites (Astro):** The public site and documentation sites are built with Astro, which is perfect for content-heavy, performance-focused websites.
-   **Game Client (Godot):** The game itself is a 2D top-down RPG built with the Godot Engine. It communicates with our backend services to fetch game data, process player actions, and receive real-time updates.

### 2. Backend Services

-   **Firebase Functions:** Our backend is built on a serverless architecture using Firebase Functions. This allows us to write scalable, event-driven backend logic in TypeScript without managing servers.
-   **Firebase Authentication:** We use Firebase Authentication to manage user accounts, providing secure and easy-to-use authentication.
-   **Firestore:** Our primary database is Firestore, a NoSQL document database that provides real-time data synchronization and powerful querying capabilities.
-   **Firebase Storage:** We use Firebase Storage to store user-generated content and other large files.

### 3. AI Integration

-   **Genkit:** We use Google's Genkit as our AI framework. It provides a robust and extensible way to build AI-powered features, from dynamic NPC dialogue to generative world events. Genkit allows us to integrate with various AI models and services seamlessly.

## Monorepo & Tooling

-   **Bun:** We use Bun as our primary runtime for TypeScript/JavaScript, providing a fast and modern development environment with built-in package management, testing, and bundling.
-   **Moon:** The entire project is managed as a monorepo using Moon, which helps us manage dependencies, run tasks, and maintain a consistent development experience across all our applications and packages.
