# Agent Instructions

## Workflow

- Use semantic/structural tools before raw text search when changing code.
- Use LSP first for known symbols, definitions, references, diagnostics, hover/type info, and callsite tracing.
- Use AST search first for syntax/code-shape questions.
- Use Semble for behavior/concept discovery.
- Use grep/rg for exact literals, verification, and fallback.

## Jujutsu and Git

- Use jj for local VCS operations.
- Use Git only for remote interoperability.
- Do not use Git staged-index workflows.
- Before starting, inspect `jj status`.
- After completing coherent work, use the established jj finish flow.
