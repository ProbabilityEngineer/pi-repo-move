# Agent Instructions

## Repository

- `pi-repo-move` is a TypeScript Pi extension for moving the current repository while keeping its Pi session history connected.
- Keep path migration explicit and preserve session continuity and canonical path handling.
- The extension entry point is `index.ts`.

## Validation

- Run `npm run lint` after implementation changes.
- Test path/session behavior without deleting source repositories or history.

## Version control

- Use normal Git workflows. Inspect `git status` and the diff before committing or pushing.
