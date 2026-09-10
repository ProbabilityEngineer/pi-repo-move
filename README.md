# pi-repo-move

> One of my diet context engineering and workflow extensions. Explore the complete collection: <https://www.npmjs.com/~probabilityengineer>

Move the current repo and keep its Pi session history connected.

`pi-repo-move` gives Pi a guarded `/repo-move` command for moving the active repository directory while preserving session continuity. It performs preflight checks before mutation, blocks unsafe path relationships, detects dirty Git working copies, moves the repository, records move evidence, and offers to create an exact-session restart script in the new location.

It is intentionally narrow: `pi-repo-move` owns filesystem repo moves. Session-only moves remain separate.

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
- dirty Git working copies ask for confirmation
- after a successful move, Pi asks whether to prepare a restart in the new location
- accepting writes an executable timestamped script under `~/.pi/agent/repo-move/restart-scripts/` and updates `latest.sh`
- the script changes to the target directory and resumes the exact relocated session with `exec pi --session ...`
- if the current session has a meaningful display name, the script also restores it with `--name`
- declining, or using the fallback manually, uses:

```bash
cd '<target>'
pi -c
```

The current relocated session is touched before restart guidance is shown, so the `pi -c` fallback selects it from the target cwd bucket. Timestamped scripts are retained for recovery; `latest.sh` always points to the newest one.

Move records append normal move evidence to the shared session-move manifest:

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
