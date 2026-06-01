---
id: pm-docs-boundary
status: closed
type: task
priority: 2
created: 2026-06-01T00:00:00Z
---
# Document pi-repo-move boundary

Document that `pi-repo-move` owns filesystem repo moves, while session-only relocation remains in the session relocation extension and canonical replay/export remains in agent-session-store.

## Acceptance Criteria

- README explains `/repo-move <target>` semantics.
- README states source is current repo root.
- README distinguishes filesystem repo move from session-only relocation.
- README documents dirty-state confirmation and hard blockers.


## Closure

Updated README with `/repo-move <target>` semantics, current repo root source, hard blockers, dirty-state confirmation, and the boundary that pi-repo-move owns filesystem repo moves while session-only relocation remains separate.
