---
id: pm-gh2v
status: open
deps: []
links: []
created: 2026-06-01T19:47:55Z
type: bug
priority: 1
assignee: ProbabilityEngineer
tags: [resume, pi-c, session-bucket]
---
# Keep pi -c deterministic after repo move

After /move relocates all bucket sessions, compact restart guidance should still make `pi -c` resume the intended current live session without exposing long `--session` paths.

## Design

Ensure the current live relocated session is the latest/default candidate in the target cwd bucket. Avoid printing long session paths by default. Consider ordering writes, mtime normalization, or a small hidden marker/helper if Pi resume selection requires it.

## Acceptance Criteria

- /move relocates all source bucket sessions.
- `cd '<target>'; pi -c` resumes the current live session.
- No long session file path is printed in normal success output.
- npm run lint passes.

