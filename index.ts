import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CommandCtx = {
	cwd: string;
	ui: { notify: (message: string, level?: "info" | "warning" | "error") => void; confirm: (title: string, message: string) => Promise<boolean> };
	sessionManager?: { getSessionFile?: () => string | undefined; getSessionId?: () => string | undefined; getSessionName?: () => string | undefined; getDisplayName?: () => string | undefined };
};

type Preflight = { source: string; target: string; sessionFile?: string; bucketSessions: string[]; dirty: string[]; blockers: string[] };
type RelocationRecord = {
	ts: string;
	fromCwd: string;
	toCwd: string;
	sourceSession: string;
	destinationSession: string;
	parent: string;
	replacements: number | null;
	sourceSessionId?: string;
	destinationSessionId?: string;
	mode: "move";
	operationType: "repo_move";
	tool: "pi-move-repo";
	sourceRepo: string;
	targetRepo: string;
	sourceLinesAtEvent?: number;
	sourceBytesAtEvent?: number;
};

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseWords(args: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;
	for (const char of args) {
		if (escaping) { current += char; escaping = false; continue; }
		if (char === "\\") { escaping = true; continue; }
		if (quote) { if (char === quote) quote = undefined; else current += char; continue; }
		if (char === "'" || char === '"') { quote = char; continue; }
		if (/\s/.test(char)) { if (current) { words.push(current); current = ""; } continue; }
		current += char;
	}
	if (escaping) current += "\\";
	if (current) words.push(current);
	return words;
}

function normalizeDraggedPath(value: string): string {
	return value.replace(/\\(.)/g, "$1");
}

function expandLeadingTilde(value: string): string {
	if (value === "~" || value.startsWith("~/")) {
		const home = process.env.HOME;
		if (!home) throw new Error("Cannot expand ~ because HOME is not set.");
		return value === "~" ? home : join(home, value.slice(2));
	}
	if (/^~[^/]/.test(value)) throw new Error(`Unsupported tilde path form: ${value}. Use ~/path or an absolute path.`);
	return value;
}

function normalizeTargetArg(value: string, baseCwd: string): string {
	const normalized = expandLeadingTilde(normalizeDraggedPath(value));
	return resolve(isAbsolute(normalized) ? normalized : resolve(baseCwd, normalized));
}

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? ".", ".pi", "agent");
}

function sessionBucketName(cwd: string): string {
	const normalized = resolve(cwd).replace(/[/\\]+$/g, "");
	const withoutRoot = normalized.replace(/^[/\\]+/, "");
	return `--${withoutRoot.replace(/[/\\:]+/g, "-")}--`;
}

function shortPath(path: string): string {
	const home = process.env.HOME;
	return home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function isSameOrInside(child: string, parent: string): boolean {
	const rel = relative(parent, child);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(() => true, () => false);
}

async function findRepoRoot(start: string): Promise<string | undefined> {
	let current = resolve(start);
	while (true) {
		if (await exists(join(current, ".jj")) || await exists(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

async function vcsDirty(root: string): Promise<string[]> {
	const dirty: string[] = [];
	if (await exists(join(root, ".jj"))) {
		try {
			const { stdout } = await execFileAsync("jj", ["status", "--no-pager"], { cwd: root });
			if (!stdout.includes("The working copy has no changes.")) dirty.push("jj working copy has changes");
		} catch {
			dirty.push("jj status could not be checked");
		}
	}
	if (await exists(join(root, ".git"))) {
		try {
			const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: root });
			if (stdout.trim()) dirty.push("git working tree has changes");
		} catch {
			dirty.push("git status could not be checked");
		}
	}
	return [...new Set(dirty)];
}

function parseSessionId(path: string): string | undefined {
	return basename(path).match(/(?:^|_)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_|$)/i)?.[1];
}

function uniqueRelocatedName(sourceFile: string): string {
	const base = basename(sourceFile).replace(/\.jsonl$/i, "").split("_relocated_")[0]?.slice(0, 80) || "session";
	const sourceHash = createHash("sha256").update(sourceFile).digest("hex").slice(0, 12);
	return `${base}_relocated_${sourceHash}.jsonl`;
}

function replaceAllLiteral(input: string, from: string, to: string): string {
	return input.split(from).join(to);
}

function manifestFile(): string {
	return join(agentDir(), "relocations.jsonl");
}

function storeFile(): string {
	return join(agentDir(), "session-store", "session-store.sqlite");
}

function hashId(prefix: string, ...parts: (string | undefined)[]) {
	return `${prefix}_${parts.filter(Boolean).join("\u0000").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 48)}_${Math.abs(parts.join("\u0000").split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)).toString(16)}`;
}

function sessionFileId(path: string) {
	return hashId("session", path);
}

function observationId(path: string) {
	return hashId("obs", path);
}

function initStore(db: DatabaseSync) {
	db.exec(`
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL, uri TEXT NOT NULL, label TEXT, first_observed_at TEXT, last_observed_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_session_id TEXT, canonical_key TEXT NOT NULL UNIQUE, first_seen_at TEXT, last_seen_at TEXT, start_timestamp TEXT, end_timestamp TEXT, event_count INTEGER, line_count INTEGER, byte_count INTEGER, content_sha256 TEXT, prefix_sha256 TEXT, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS session_observations (id TEXT PRIMARY KEY, session_id TEXT, source_id TEXT, path TEXT, provider_session_id TEXT, observed_at TEXT, snapshot_label TEXT, file_birthtime TEXT, file_mtime TEXT, file_size INTEGER, line_count INTEGER, first_event_at TEXT, last_event_at TEXT, content_sha256 TEXT, prefix_sha256 TEXT, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, source_session_id TEXT, target_session_id TEXT, edge_type TEXT NOT NULL, timestamp TEXT, source_observation_id TEXT, target_observation_id TEXT, confidence TEXT NOT NULL, provenance TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS observation_marks (id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, mark_type TEXT NOT NULL, reason TEXT, replacement_observation_id TEXT, source TEXT NOT NULL, timestamp TEXT NOT NULL, confidence TEXT NOT NULL, manual_review_required INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}');
`);
}

async function sessionStats(path: string) {
	try {
		const [raw, st] = await Promise.all([readFile(path, "utf8"), stat(path)]);
		const lines = raw.split("\n").filter((line) => line.trim());
		return { lineCount: lines.length, byteCount: st.size, fileBirthtime: st.birthtime.toISOString(), fileMtime: st.mtime.toISOString() };
	} catch {
		return { lineCount: null, byteCount: null, fileBirthtime: null, fileMtime: null };
	}
}

async function appendManifest(record: RelocationRecord): Promise<void> {
	await mkdir(dirname(manifestFile()), { recursive: true });
	await writeFile(manifestFile(), `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

async function appendStoreRecord(record: RelocationRecord): Promise<void> {
	await mkdir(dirname(storeFile()), { recursive: true });
	const db = new DatabaseSync(storeFile());
	try {
		initStore(db);
		const sourceId = "source_pi_move_repo_manifest";
		db.prepare("INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(sourceId, "pi", "relocation_manifest", manifestFile(), "Pi move repo relocation manifest", null, null, "{}");
		const upsertSession = db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const upsertObs = db.prepare("INSERT OR REPLACE INTO session_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const upsertEdge = db.prepare("INSERT OR REPLACE INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const upsertMark = db.prepare("INSERT OR REPLACE INTO observation_marks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const sourceSessionId = sessionFileId(record.sourceSession);
		const destSessionId = sessionFileId(record.destinationSession);
		const sourceObsId = observationId(record.sourceSession);
		const destObsId = observationId(record.destinationSession);
		const sourceStats = await sessionStats(record.sourceSession);
		const destStats = await sessionStats(record.destinationSession);
		upsertSession.run(sourceSessionId, "pi", record.sourceSessionId ?? null, record.sourceSession, null, record.ts, null, null, null, sourceStats.lineCount, sourceStats.byteCount, null, null, JSON.stringify({ cwd: record.fromCwd, repo: record.sourceRepo }));
		upsertSession.run(destSessionId, "pi", record.destinationSessionId ?? null, record.destinationSession, record.ts, null, null, null, null, destStats.lineCount, destStats.byteCount, null, null, JSON.stringify({ cwd: record.toCwd, repo: record.targetRepo }));
		upsertObs.run(sourceObsId, sourceSessionId, sourceId, record.sourceSession, record.sourceSessionId ?? null, record.ts, null, sourceStats.fileBirthtime, sourceStats.fileMtime, sourceStats.byteCount, sourceStats.lineCount, null, null, null, null, JSON.stringify({ cwd: record.fromCwd, repo: record.sourceRepo }));
		upsertObs.run(destObsId, destSessionId, sourceId, record.destinationSession, record.destinationSessionId ?? null, record.ts, null, destStats.fileBirthtime, destStats.fileMtime, destStats.byteCount, destStats.lineCount, null, null, null, null, JSON.stringify({ cwd: record.toCwd, repo: record.targetRepo }));
		upsertEdge.run(hashId("edge", record.ts, record.sourceSession, record.destinationSession), sourceSessionId, destSessionId, "repo_move", record.ts, sourceObsId, destObsId, "authoritative", "pi-move-repo", JSON.stringify({ fromCwd: record.fromCwd, toCwd: record.toCwd, sourceRepo: record.sourceRepo, targetRepo: record.targetRepo, replacements: record.replacements, parent: record.parent, sourceSessionId: record.sourceSessionId, destinationSessionId: record.destinationSessionId, mode: record.mode, operationType: record.operationType, tool: record.tool, sourceLinesAtEvent: record.sourceLinesAtEvent, sourceBytesAtEvent: record.sourceBytesAtEvent }));
		upsertMark.run(hashId("mark", sourceObsId, "superseded", destObsId, record.ts), sourceObsId, "superseded", "repo moved by pi-move-repo move semantics", destObsId, "pi-move-repo", record.ts, "authoritative", 1, JSON.stringify({ operationType: record.operationType, tool: record.tool, sourceRepo: record.sourceRepo, targetRepo: record.targetRepo }));
		upsertMark.run(hashId("mark", sourceObsId, "deletion_candidate", destObsId, record.ts), sourceObsId, "deletion_candidate", "old repo-bucket copy after repo move; requires manual review before deletion", destObsId, "pi-move-repo", record.ts, "authoritative", 1, JSON.stringify({ operationType: record.operationType, tool: record.tool, sourceRepo: record.sourceRepo, targetRepo: record.targetRepo }));
	} finally {
		db.close();
	}
}

async function sessionFilesInBucket(cwd: string): Promise<string[]> {
	const bucketDir = join(agentDir(), "sessions", sessionBucketName(cwd));
	const entries = await readdir(bucketDir, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => join(bucketDir, entry.name))
		.sort((a, b) => a.localeCompare(b));
}

async function orderedBucketSessions(bucketSessions: string[], currentSession?: string): Promise<string[]> {
	const deduped = [...new Set(bucketSessions.map((session) => resolve(session)))];
	const mtimes = new Map<string, number>();
	await Promise.all(deduped.map(async (session) => {
		const st = await stat(session).catch(() => undefined);
		mtimes.set(session, st?.mtimeMs ?? 0);
	}));
	const current = currentSession ? resolve(currentSession) : undefined;
	return deduped.sort((a, b) => {
		if (current) {
			if (a === current) return 1;
			if (b === current) return -1;
		}
		const byMtime = (mtimes.get(a) ?? 0) - (mtimes.get(b) ?? 0);
		return byMtime || a.localeCompare(b);
	});
}

async function relocateSessionFile(sessionFile: string, source: string, target: string): Promise<RelocationRecord> {
	const original = await readFile(sessionFile, "utf8");
	let relocated = replaceAllLiteral(original, source, target);
	relocated = replaceAllLiteral(relocated, source.replace(/\//g, "\\/"), target.replace(/\//g, "\\/"));
	const replacements = original === relocated ? 0 : original.split(source).length - 1;
	const destinationDir = join(agentDir(), "sessions", sessionBucketName(target));
	await mkdir(destinationDir, { recursive: true });
	const destinationSession = join(destinationDir, uniqueRelocatedName(sessionFile));
	await writeFile(destinationSession, relocated, { encoding: "utf8", flag: "wx" });
	const sessionId = parseSessionId(sessionFile);
	const record: RelocationRecord = {
		ts: new Date().toISOString(),
		fromCwd: source,
		toCwd: target,
		sourceSession: sessionFile,
		destinationSession,
		parent: sessionFile,
		replacements,
		sourceSessionId: sessionId,
		destinationSessionId: sessionId,
		mode: "move",
		operationType: "repo_move",
		tool: "pi-move-repo",
		sourceRepo: source,
		targetRepo: target,
		sourceLinesAtEvent: original.split("\n").filter((line) => line.trim()).length,
		sourceBytesAtEvent: Buffer.byteLength(original),
	};
	await appendManifest(record);
	await appendStoreRecord(record);
	return record;
}

async function preflight(targetArg: string, ctx: CommandCtx): Promise<Preflight> {
	const blockers: string[] = [];
	const source = await findRepoRoot(ctx.cwd);
	if (!source) return { source: ctx.cwd, target: targetArg, blockers: ["source repo root could not be found from current cwd"], bucketSessions: [], dirty: [] };
	let target = "";
	try { target = normalizeTargetArg(targetArg, ctx.cwd); } catch (error) { blockers.push(error instanceof Error ? error.message : String(error)); }
	if (target) {
		if (target === source) blockers.push("target is the same as source");
		if (isSameOrInside(target, source)) blockers.push("target is inside source repo");
		if (isSameOrInside(source, target)) blockers.push("source repo is inside target");
		if (await exists(target)) blockers.push("target already exists");
		const parent = dirname(target);
		let ancestor = parent;
		while (!(await exists(ancestor)) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
		try { await access(ancestor, constants.W_OK); } catch { blockers.push(`target parent cannot be created or written: ${parent}`); }
	}
	const sessionFile = ctx.sessionManager?.getSessionFile?.();
	if (!sessionFile) blockers.push("current Pi session has no session file");
	else if (!(await exists(sessionFile))) blockers.push(`current session file is missing: ${sessionFile}`);
	const bucketSessions = source ? await sessionFilesInBucket(source) : [];
	if (sessionFile) bucketSessions.push(sessionFile);
	return { source, target, sessionFile, bucketSessions: await orderedBucketSessions(bucketSessions, sessionFile), blockers, dirty: blockers.length ? [] : await vcsDirty(source) };
}

function blockedMessage(plan: Preflight): string {
	return [
		"Move blocked",
		"",
		"Repo:",
		`  from: ${plan.source}`,
		`  to:   ${plan.target}`,
		"",
		"Problems:",
		...plan.blockers.map((item) => `  - ${item}`),
		"",
		"Nothing was changed.",
	].join("\n");
}

function compactSuccess(target: string): string {
	return [
		`Moved → ${target}`,
		"",
		"Run:",
		`cd ${shellQuote(target)}`,
		"pi -c",
	].join("\n");
}

async function performMove(targetArg: string, ctx: CommandCtx): Promise<string | undefined> {
	const plan = await preflight(targetArg, ctx);
	if (plan.blockers.length) {
		ctx.ui.notify(blockedMessage(plan), "error");
		return;
	}
	if (plan.dirty.length) {
		const ok = await ctx.ui.confirm("Working copy has changes. Continue move?", [`Repo: ${plan.source}`, `Target: ${plan.target}`, "", ...plan.dirty.map((item) => `- ${item}`)].join("\n"));
		if (!ok) {
			ctx.ui.notify("Move cancelled. Nothing was changed.", "info");
			return;
		}
	}
	try {
		await mkdir(dirname(plan.target), { recursive: true });
		await rename(plan.source, plan.target);
	} catch (error) {
		ctx.ui.notify(["Move failed", "", `from: ${plan.source}`, `to:   ${plan.target}`, "", error instanceof Error ? error.message : String(error)].join("\n"), "error");
		return;
	}

	const failures: string[] = [];
	let relocated = 0;
	for (const sessionFile of plan.bucketSessions) {
		try {
			await relocateSessionFile(sessionFile, plan.source, plan.target);
			relocated++;
		} catch (error) {
			failures.push(`${shortPath(sessionFile)}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	if (failures.length) {
		ctx.ui.notify([
			"Repo moved, but some sessions failed to relocate",
			"",
			`from: ${plan.source}`,
			`to:   ${plan.target}`,
			`sessions relocated: ${relocated}/${plan.bucketSessions.length}`,
			"",
			"Failures:",
			...failures.slice(0, 10).map((failure) => `- ${failure}`),
			...(failures.length > 10 ? [`- ... ${failures.length - 10} more`] : []),
			"",
			"Run:",
			`cd ${shellQuote(plan.target)}`,
			"pi -c",
		].join("\n"), "warning");
		return;
	}
	return compactSuccess(plan.target);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("move", {
		description: "Move the current repo and relocate its Pi session bucket: /move <target>",
		handler: async (args, ctx) => {
			const words = parseWords(args);
			const target = words.join(" ").trim();
			if (!target) return ctx.ui.notify("Usage: /move <target>", "error");
			const result = await performMove(target, ctx as CommandCtx);
			if (result) ctx.ui.notify(result, "info");
		},
	});
}

export { preflight, sessionBucketName };
