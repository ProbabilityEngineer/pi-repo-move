# pi-move

Pi extension for moving the current repo directory and relocating its Pi session bucket.

Planned command:

```text
/move <target>
```

Behavior goal:

- source is the current repo root/current cwd repo
- target is the new repo path
- preflight runs silently
- hard blockers print diagnostics and stop without changes
- dirty jj/git working copies ask for confirmation
- successful moves print only the new path and restart command:

```bash
cd '<target>'
pi -c
```

`pi-move` owns filesystem repo moves. Session-only relocation remains separate.
