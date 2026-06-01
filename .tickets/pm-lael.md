---
id: pm-lael
status: closed
deps: []
links: []
created: 2026-06-01T19:08:27Z
type: bug
priority: 1
assignee: ProbabilityEngineer
tags: [pi-move, session-bucket, repo-move]
---
# Relocate all source bucket sessions during repo move

`/move <target>` must relocate every Pi session JSONL in the source cwd bucket, not only the current live session. The repo directory move changes the cwd identity for the whole bucket; leaving older sessions behind makes history/status/replay incomplete.

## Design

Enumerate all session files in the source cwd bucket before renaming the repo. For each file, write a relocated copy into the target cwd bucket and append a repo_move relocation manifest. Track the current live session among the relocated files so compact restart guidance remains targeted to the target cwd. Preserve raw source JSONLs and report per-session failures.

## Acceptance Criteria

- /move <target> relocates all JSONL files from the source cwd bucket.
- Current live session is included and success output remains compact: cd '<target>'; pi -c.
- Manifest records are written for every relocated session with top-level repo_move/tool/sourceRepo/targetRepo fields.
- Source session files are preserved.
- Per-session failures are reported without silently dropping non-current sessions.
- Existing blockers and dirty VCS confirmation behavior remain unchanged.

