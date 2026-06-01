---
id: prm-session-move-namespaced-manifest
status: closed
deps: []
links: []
created: 2026-06-01T00:00:00Z
type: feature
priority: 2
assignee: ProbabilityEngineer
tags: [paths, repo-move, manifest]
---
# Write repo-move manifests to session-move namespace

`pi-repo-move` appends relocation evidence for repo moves. It should coordinate with the new `~/.pi/agent/session-move/manifests/` layout while preserving legacy compatibility.

## Design

Once `pi-session-move` and `agent-session-store` support the namespaced path, update `pi-repo-move` to append `repo_move` records to:

```text
~/.pi/agent/session-move/manifests/relocations.jsonl
```

Readers must still tolerate legacy:

```text
~/.pi/agent/relocations.jsonl
```

Do not rewrite old records.

## Acceptance Criteria

- New `/repo-move` records append to the namespaced session-move manifest.
- Records retain top-level `operationType` / `tool` / `sourceRepo` / `targetRepo` fields.
- Legacy manifests remain untouched.
- `agent-session-store` can import `repo_move` records from the new path.
- `npm run lint` passes.
