---
id: pm-move-current-repo
status: open
type: feature
priority: 1
created: 2026-06-01T00:00:00Z
---
# Implement /move <target>

Move the current repo directory to a target path and relocate its Pi session bucket.

## Acceptance Criteria

- `/move <target>` resolves the current repo root as source.
- Leading `~` target paths expand to the user's home directory.
- Dragged/quoted paths normalize safely.
- Hard blockers stop before mutation and print diagnostics.
- Hard blockers include target exists, target equals source, target inside source, source inside target, source repo root not found, target parent cannot be created, permission errors, and missing current session file when relocation is required.
- If jj or git working copy is dirty, prompt `Continue move? [y/N]` before mutating.
- Successful output is compact and includes:

```bash
cd '<target>'
pi -c
```
