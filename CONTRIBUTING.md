# Contributing to Aikami

First off, thank you for considering contributing to Aikami! It's people like you that make open source projects such a great experience. We welcome contributions of all kinds, from bug fixes to new features.

This document provides a high-level overview of how to get started. For more detailed information, please refer to our full documentation:

- [**Project Structure**](./docs/STRUCTURE.md)
- [**Technology Stack**](./docs/STACK.md)
- [**Architecture**](./docs/ARCHITECTURE.md)
- [**Coding Standards**](./docs/CODING_STANDARDS.md)

## Getting Started

### Prerequisites

- **Deno:** The project uses Deno as the primary JavaScript/TypeScript runtime. You can find installation instructions at [deno.land](https://deno.land/).
- **Moon:** Our monorepo is managed with Moon. While not strictly required for all tasks, it's recommended for a seamless experience. Installation instructions are at [moonrepo.dev](https://moonrepo.dev/).
- **Godot Engine:** To work on the game client, you'll need the latest stable version of the Godot Engine. You can download it from [godotengine.org](https://godotengine.org/).

### Setup

1.  **Fork & Clone:** Fork the repository to your own GitHub account and then clone it to your local machine.
2.  **Install Dependencies:** This project uses `deno` and does not rely on a `node_modules` folder in the same way a traditional Node.js project does. Dependencies are managed in the root `deno.json` file and are cached by Deno on first use.

### Running the Project

You can run the various applications in the monorepo using Deno tasks defined in the root `deno.json`.

-   **Run the PWA:**
    ```bash
    deno task dev:pwa
    ```
-   **Run the Docs Site:**
    ```bash
    deno task dev:docs
    ```
-   **Run the Landing Page:**
    ```bash
    deno task dev:landing
    ```

### Development Workflow

1.  **Create a Branch:** Create a new branch for your feature or bug fix.
    ```bash
    git checkout -b my-new-feature
    ```
2.  **Make Changes:** Make your changes to the codebase.
3.  **Check Your Work:** Before committing, be sure to run the linter and formatter.
    ```bash
    # Format all files
    deno task format

    # Lint all files
    deno task lint

    # Run type checks
    deno task check
    ```
4.  **Commit:** Commit your changes with a descriptive commit message.
    ```bash
    git commit -m "feat: add my new feature"
    ```
5.  **Push:** Push your changes to your fork.
    ```bash
    git push origin my-new-feature
    ```
6.  **Create a Pull Request:** Open a pull request from your fork to the main Aikami repository.

Thank you for your contribution!
