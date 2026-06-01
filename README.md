# pi-move-repo

Pi extension for moving the current repo directory and relocating its Pi session bucket.

Command:

```text
/move <target>
```

Behavior:

- source is the current repo root/current cwd repo
- target is the new repo path
- preflight runs silently before mutation
- hard blockers print diagnostics and stop without changes
- dirty jj/git working copies ask for confirmation
- successful moves print only the new path and restart command:

```bash
cd '<target>'
pi -c
```

`pi-move-repo` owns filesystem repo moves. Session-only relocation remains separate.

Move records append normal relocation evidence plus first-class repo-move fields:

```json
{
  "operationType": "repo_move",
  "tool": "pi-move-repo",
  "sourceRepo": "/old/repo",
  "targetRepo": "/new/repo"
}
```

## Hard blockers

`/move <target>` stops before mutation when:

- target already exists
- target equals source
- target is inside source
- source is inside target
- source repo root cannot be found
- target parent cannot be created or written
- current Pi session file is missing

If the jj or git working copy is dirty, `/move` asks whether to continue instead of blocking.
