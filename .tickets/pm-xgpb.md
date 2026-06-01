---
id: pm-xgpb
status: closed
deps: []
links: []
created: 2026-06-01T19:48:45Z
type: bug
priority: 1
assignee: ProbabilityEngineer
tags: [filenames, relocation]
---
# Bound relocated session filenames

Relocated session filenames currently append `_relocated_<timestamp>` repeatedly, making names grow over repeated relocations and eventually risking filesystem/path length failures.

## Design

Generate bounded relocated filenames by keeping only the original base before any `_relocated_`, truncating it, and appending a short hash suffix instead of a timestamp string. Timestamps remain in manifest records, not filenames.

## Acceptance Criteria

- New pi-move relocated session filenames do not include relocated timestamps.
- Filename length remains bounded across repeated relocations.
- Manifest records still contain event timestamps.
- npm run lint passes.

