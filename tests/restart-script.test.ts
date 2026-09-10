import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeRestartScripts } from "../index.ts";

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
