---
id: pm-qurw
status: closed
deps: []
links: []
created: 2026-06-01T20:03:02Z
type: bug
priority: 2
assignee: ProbabilityEngineer
tags: [session-bucket, mtime, resume]
---
# Copy bucket sessions in source mtime order

`/move` currently copies non-current source bucket sessions in lexicographic path order, with the current live session forced last. Source mtime is a better proxy for original session recency and makes the target bucket chronology closer to the source bucket.

## Design

During preflight, stat each bucket session and sort non-current sessions by source file mtime ascending, using path as a deterministic tie-breaker. Continue to force the current live session last so compact `pi -c` resumes the intended live session.

## Acceptance Criteria

- Non-current bucket sessions are relocated oldest-to-newest by source mtime.
- Ties are deterministic by path.
- Current live session remains last regardless of source mtime.
- npm run lint passes.

