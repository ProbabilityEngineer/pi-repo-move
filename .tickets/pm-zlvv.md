---
id: pm-zlvv
status: closed
deps: []
links: []
created: 2026-06-01T19:54:44Z
type: feature
priority: 1
assignee: ProbabilityEngineer
tags: [store, prune, repo-move, superseded]
---
# Mark repo move sources superseded in canonical store

`pi-move` should participate in the same superseded/deletion-candidate model as `pi-relocate`: source bucket JSONLs copied by `/move` should remain physically preserved, but canonical store marks should indicate they are superseded and manual-review deletion candidates.

## Design

After appending each repo_move manifest record, upsert minimal canonical store rows and observation_marks equivalent to pi-relocate move semantics. Use `tool: pi-move`, source `source_pi_move_manifest`, edge metadata with operationType/sourceRepo/targetRepo, and mark source observations as `superseded` and `deletion_candidate` with manual_review_required=1. Do not delete or stage source files.

## Acceptance Criteria

- /move does not delete source JSONLs.
- Each successful relocated session gets canonical observation marks: superseded and deletion_candidate.
- Marks point to the relocated destination observation.
- Manifest remains append-only.
- npm run lint passes.

