# Contributing to AiKami

Thank you for your interest in contributing to AiKami! We're excited to have you join our community and help improve the game. This document will guide you through the contribution process and outline the steps you need to follow to contribute to the project.

## Getting Started

Before you can start contributing, there are a few tools and standards you need to be familiar with. This will help ensure that your contributions are consistent with the rest of the project and can be integrated smoothly.

### Prerequisites

1. **GDScript**: All game logic is written in GDScript, so familiarity with it is essential.
2. **Godot Engine**: You should have the latest stable version of the Godot Engine installed to test your changes locally.

### Required Tools

To contribute to this project, you need to have the following tools installed:

-   **GDScript Toolkit**: This is used for linting GDScript code to ensure it meets our coding standards.
-   **Lefthook**: We use Lefthook to set up git hooks that automate certain checks and tasks.

#### Installing GDScript Toolkit

You can install the GDScript Toolkit by running:

```sh
pip3 install "gdtoolkit==4.*"
```

#### Installing Lefthook

To setup lefthook you can install [bun](https://bun.sh/docs/installation)
and run

```sh
bun install
```

Or if you only want to work with godot you can install lefthook [here](https://github.com/evilmartians/lefthook/blob/master/docs/install.md)

## Making Contributions

### Fork and Clone the Repository

To start contributing, fork the repository on GitHub, then clone your fork locally.

```sh
git clone https://github.com/BearlySleeping/aikami.git
```

### Following the Coding Standards

Our project adheres to coding standards defined in the `game/.gdlintrc` file. Please ensure your contributions follow these guidelines. You can check your code with the GDScript Toolkit.

### Submitting Changes

1. Create a new branch for your changes.
2. Make your changes and commit them with clear, concise commit messages.
3. Push your branch to your fork on GitHub.
4. Open a pull request against the main repository with a description of your changes.

## Code Review Process

Once you've submitted a pull request, the project maintainers will review your changes. We might suggest some changes or improvements. This is a normal part of the contribution process, so please don't be discouraged!

## Questions?

If you have any questions or need further assistance, feel free to open an issue in the repository or ask in our community chat (if available).

Thank you for contributing to AiKami! Your efforts help make the game better for everyone.
