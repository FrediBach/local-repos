# Project documentation

These documents describe the current implementation of Local Repos. Start with
the architecture overview, then read the guide for the area you are changing.

- [Architecture](architecture.md): runtime boundaries, shared data model, source
  map, deployment, and design constraints.
- [Frontend](frontend.md): UI composition, state, persistence, scanning, and
  coordination of user and background actions.
- [Local helper](local-helper.md): API, project registry, filesystem access,
  processes, maintenance, and concurrency safeguards.
- [Development](development.md): setup, commands, testing, and build workflow.

The root [README](../README.md) is the user guide. [AGENTS.md](../AGENTS.md)
contains instructions for agents working on the repository. Keep these documents
aligned with code changes; implementation links identify the source of truth for
details such as limits, supported commands, and stored data.
