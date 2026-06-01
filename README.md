# pi-repo-move

Move the current repo and keep its Pi session history connected.

`pi-repo-move` gives Pi a guarded `/repo-move` command for moving the active repository directory while preserving session continuity. It performs preflight checks before mutation, blocks unsafe path relationships, detects dirty jj/git working copies, moves the repository, records relocation evidence, and prints the exact restart command.

It is intentionally narrow: `pi-repo-move` owns filesystem repo moves. Session-only relocation remains separate.

## Install

From npm:

```bash
pi install npm:pi-repo-move
```

From GitHub:

```bash
pi install git:github.com/ProbabilityEngineer/pi-repo-move
```

For project-local install, add `-l`:

```bash
pi install -l npm:pi-repo-move
```

## Command

```text
/repo-move <target>
```

Behavior:

- source is the current repo root/current cwd repo
- target is the new repo path
- preflight runs before mutation
- hard blockers print diagnostics and stop without changes
- dirty jj/git working copies ask for confirmation
- successful moves print only the new path and restart command:

```bash
cd '<target>'
pi -c
```

Move records append normal relocation evidence to the shared session-move manifest:

```text
~/.pi/agent/session-move/manifests/relocations.jsonl
```

Legacy top-level manifests remain readable by downstream tools but are not rewritten. Records include first-class repo-move fields:

```json
{
  "operationType": "repo_move",
  "tool": "pi-repo-move",
  "sourceRepo": "/old/repo",
  "targetRepo": "/new/repo"
}
```

## Hard blockers

`/repo-move <target>` stops before mutation when:

- target already exists
- target equals source
- target is inside source
- source is inside target
- source repo root cannot be found
- target parent cannot be created or written
- current Pi session file is missing

If the jj or git working copy is dirty, `/repo-move` asks whether to continue instead of blocking.

## Prompt overhead

`pi-repo-move` registers one focused slash command and does not inject dynamic repository status into prompts.
