---
id: pm-session-bucket-relocation
status: closed
type: feature
priority: 1
created: 2026-06-01T00:00:00Z
---
# Relocate Pi session bucket during repo move

When moving a repo, copy/relocate the current Pi session JSONL into the target cwd bucket and append relocation evidence without mutating raw logs directly.

## Acceptance Criteria

- Does not mutate existing raw session JSONLs except creating the relocated copy.
- Appends raw relocation evidence to `~/.pi/agent/relocations.jsonl` using existing manifest semantics.
- Writes restart helper/latest script if that remains shared suite behavior, but direct `cd ...; pi -c` is primary UX.
- Uses move semantics by default; source evidence remains raw/append-only.
- Preserves compatibility with agent-session-store replay.


## Closure

Implemented current-session bucket relocation during repo moves by writing a relocated session JSONL into the target cwd bucket and appending a Pi relocation manifest record. Existing raw session JSONLs are not mutated.
