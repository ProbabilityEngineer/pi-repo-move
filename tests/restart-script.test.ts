import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { performMove, sessionBucketName, writeRestartScripts } from "../index.ts";

test("writes an exact-session restart script and latest copy", async () => {
	const agent = await mkdtemp(join(tmpdir(), "pi-repo-move-test-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
	try {
		const historical = await writeRestartScripts("/tmp/target repo", "/tmp/session file.jsonl", "session-id", "named session");
		const latest = join(agent, "repo-move", "restart-scripts", "latest.sh");
		const content = await readFile(historical, "utf8");
		assert.equal(content, await readFile(latest, "utf8"));
		assert.match(historical, /\/run-[a-z0-9]+-[0-9a-f]{8}\.sh$/);
		assert.match(content, /cd '\/tmp\/target repo'/);
		assert.match(content, /exec pi --name 'named session' --session '\/tmp\/session file\.jsonl'/);
		assert.equal((await stat(historical)).mode & 0o777, 0o755);
		assert.equal((await stat(latest)).mode & 0o777, 0o755);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

test("switches the live Pi session after relocating a repository", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-repo-move-live-switch-"));
	const agent = join(root, "agent");
	const source = join(root, "source repo");
	const target = join(root, "target repo");
	const session = join(agent, "sessions", sessionBucketName(source), "2026-01-01_session_00000000-0000-0000-0000-000000000000.jsonl");
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
	try {
		await mkdir(join(source, ".git"), { recursive: true });
		await mkdir(join(agent, "sessions", sessionBucketName(source)), { recursive: true });
		await writeFile(session, JSON.stringify({ cwd: source }) + "\n");
		const notices: string[] = [];
		let switched: string | undefined;
		const ctx: any = {
			cwd: source,
			ui: { confirm: async () => true, notify: (message: string) => notices.push(message) },
			sessionManager: { getSessionFile: () => session, getSessionName: () => "Moved repo" },
			switchSession: async (destination: string, options: any) => {
				switched = destination;
				await options?.withSession?.(ctx);
				return {};
			},
		};
		assert.equal(await performMove(target, ctx), undefined);
		assert.ok(switched);
		assert.match(switched, /_relocated_[0-9a-f]{12}\.jsonl$/);
		assert.ok((await readFile(switched, "utf8")).includes(target));
		assert.ok(notices.some((message) => message.includes("Moved repository session active")));
		const latest = await readFile(join(agent, "repo-move", "restart-scripts", "latest.sh"), "utf8");
		assert.match(latest, /exec pi --name 'Moved repo' --session/);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});
