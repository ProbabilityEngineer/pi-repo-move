---
id: pm-preflight-diagnostics
status: open
type: task
priority: 1
created: 2026-06-01T00:00:00Z
---
# Silent preflight with failure diagnostics

Run dry-run/preflight internally for every `/move <target>`, but only print the detailed plan when blocked or confirmation is required.

## Acceptance Criteria

- Success path stays concise.
- Failure path prints source, target, problems, and `Nothing was changed.`
- Dirty jj/git state asks for confirmation instead of hard-blocking.
- No public `--check` command for now.
