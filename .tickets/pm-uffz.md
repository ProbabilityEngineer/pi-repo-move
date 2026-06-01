---
id: pm-uffz
status: closed
deps: []
links: []
created: 2026-06-01T19:16:30Z
type: bug
priority: 1
assignee: ProbabilityEngineer
tags: [pi-repo-move, resume, current-session, session-bucket]
---
# Relocate current session last during bucket repo moves

After /repo-move started relocating every session in the source cwd bucket, `pi -c` in the target repo may resume an arbitrary/newest copied bucket session instead of the live current session. The batch copy writes many sessions into the target bucket with fresh mtimes/timestamps, so Pi's resume selection can choose a non-current session copied after the live one.

## Design

Keep bucket-wide relocation, but order the relocation batch so the current live session is copied last. Build a relocation plan from all source bucket JSONLs plus the current session if absent, dedupe it, and sort with non-current sessions first and the current session last. Continue to emit repo_move manifest records for each session. If Pi resume depends on mtime/name, this makes the current session the latest target-bucket candidate after /move.

## Acceptance Criteria

- /repo-move still relocates all source bucket JSONLs.
- The current live session is relocated after all non-current bucket sessions.
- Success restart guidance `cd '<target>'; pi -c` resumes the moved live session rather than an older/arbitrary bucket session.
- Per-session failure reporting still works.
- npm run lint passes.

