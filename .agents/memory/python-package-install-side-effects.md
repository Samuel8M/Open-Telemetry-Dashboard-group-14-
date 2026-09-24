---
name: Python package install side effects
description: Environment-specific effects of installing a Python package for a one-off check in this pnpm workspace.
---

Installing a Python package through Replit's language-package manager can initialize a root Python project and alter Replit's runtime configuration, even when the package is needed only for a temporary smoke test.

**Why:** A collector smoke test introduced unrelated Python scaffolding and runtime configuration into an otherwise pnpm-managed app. Uninstalling the package did not remove all of those changes automatically.

**How to apply:** Before installing a Python package solely to verify a downloadable script, consider whether static checks suffice. If installation is needed, check workspace changes afterward and remove unrelated scaffolding; replace any altered Replit config only through its schema-validated replacement flow.