import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
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
	tool: "pi-move";
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
	const base = basename(sourceFile).replace(/\.jsonl$/i, "").split("_relocated_")[0]?.slice(0, 96) || "session";
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const sourceHash = createHash("sha256").update(sourceFile).digest("hex").slice(0, 8);
	return `${base}_relocated_${stamp}_${sourceHash}.jsonl`;
}

function replaceAllLiteral(input: string, from: string, to: string): string {
	return input.split(from).join(to);
}

function manifestFile(): string {
	return join(agentDir(), "relocations.jsonl");
}

async function appendManifest(record: RelocationRecord): Promise<void> {
	await mkdir(dirname(manifestFile()), { recursive: true });
	await writeFile(manifestFile(), `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

async function sessionFilesInBucket(cwd: string): Promise<string[]> {
	const bucketDir = join(agentDir(), "sessions", sessionBucketName(cwd));
	const entries = await readdir(bucketDir, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => join(bucketDir, entry.name))
		.sort((a, b) => a.localeCompare(b));
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
		tool: "pi-move",
		sourceRepo: source,
		targetRepo: target,
		sourceLinesAtEvent: original.split("\n").filter((line) => line.trim()).length,
		sourceBytesAtEvent: Buffer.byteLength(original),
	};
	await appendManifest(record);
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
	if (sessionFile && !bucketSessions.includes(sessionFile)) bucketSessions.push(sessionFile);
	return { source, target, sessionFile, bucketSessions: bucketSessions.sort((a, b) => a.localeCompare(b)), blockers, dirty: blockers.length ? [] : await vcsDirty(source) };
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
