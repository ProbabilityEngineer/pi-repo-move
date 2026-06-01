---
id: pm-docs-boundary
status: open
type: task
priority: 2
created: 2026-06-01T00:00:00Z
---
# Document pi-move boundary

Document that `pi-move` owns filesystem repo moves, while session-only relocation remains in the session relocation extension and canonical replay/export remains in agent-session-store.

## Acceptance Criteria

- README explains `/move <target>` semantics.
- README states source is current repo root.
- README distinguishes filesystem repo move from session-only relocation.
- README documents dirty-state confirmation and hard blockers.
