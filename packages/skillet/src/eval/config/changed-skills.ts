import fs from "node:fs";
import path from "node:path";
import { type GitChanges, assertInRepository, collectGitChanges } from "./git-changes.js";
import { loadStructuralConfig } from "./loader.js";
import { resolveSkillPaths } from "./paths.js";
import type { Config } from "./schema.js";
import { discoverSkillsFromRoots } from "./skills.js";

export interface SelectionReason {
	type: "direct" | "dependency" | "global" | "unmapped";
	path: string;
}
export interface SkillSelection {
	schemaVersion: 1;
	mode: "changed";
	requestedRef: string;
	baseCommit: string;
	headCommit: string;
	mergeBaseCommit: string;
	localChanges: boolean;
	changedPaths: GitChanges["changedPaths"];
	discoveredCount: number;
	selected: { path: string; reasons: SelectionReason[] }[];
	removed: string[];
	ignoredPaths: string[];
	unrunnable: { path: string; reason: string }[];
	status: "selected" | "no-runnable-skills";
}

const DEFAULT_GLOBALS = [
	"package.json",
	"pnpm-workspace.yaml",
	"pnpm-lock.yaml",
	"package-lock.json",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
	"pyproject.toml",
	"uv.lock",
	"poetry.lock",
	"requirements*.txt",
	".gitmodules",
];

/** Small explicit glob language: *, ?, and whole-segment **; dotfiles are matched. */
export function compilePattern(pattern: string): RegExp {
	if (
		!pattern ||
		pattern.startsWith("/") ||
		pattern.startsWith("!") ||
		/^[A-Za-z]:/.test(pattern) ||
		/[\\{}\[\]$]/.test(pattern) ||
		pattern
			.split("/")
			.some(
				(part) => !part || part === "." || part === ".." || (part.includes("**") && part !== "**"),
			)
	) {
		throw new Error(
			`Invalid changes pattern ${JSON.stringify(pattern)}. Use repository-relative paths with *, ?, or whole-segment **.`,
		);
	}
	const parts = pattern.split("/");
	let expression = "^";
	for (const [i, part] of parts.entries()) {
		if (part === "**") {
			expression += i === parts.length - 1 ? ".*" : "(?:[^/]+/)*";
		} else {
			expression += part
				.replace(/[.+^()|]/g, "\\$&")
				.replace(/\*/g, "[^/]*")
				.replace(/\?/g, "[^/]");
			if (i < parts.length - 1) expression += "/";
		}
	}
	return new RegExp(`${expression}(?![\\s\\S])`, "s");
}

function under(file: string, directory: string): boolean {
	return directory === "." || file === directory || file.startsWith(`${directory}/`);
}
function relative(root: string, file: string): string {
	return path.relative(root, file).split(path.sep).join("/") || ".";
}

/** Pure classification: unknown outside inputs deliberately select every current skill. */
export function selectAffectedSkills(input: {
	changes: GitChanges["changedPaths"];
	current: string[];
	previous: string[];
	configPath: string;
	rules?: Config["changes"];
}): Pick<SkillSelection, "selected" | "removed" | "ignoredPaths"> {
	const { current, previous, rules } = input;
	const globals = [...DEFAULT_GLOBALS, ...(rules?.global ?? [])].map(compilePattern);
	const ignores = [".skillet-evals/**", ...(rules?.ignore ?? [])].map(compilePattern);
	const known = [...new Set([...current, ...previous])];
	const dependencies = (rules?.dependencies ?? []).map((rule) => {
		const patterns = rule.skills.map(compilePattern);
		for (const [i, pattern] of patterns.entries()) {
			if (!known.some((skill) => pattern.test(skill))) {
				throw new Error(
					`Dependency consumer pattern ${JSON.stringify(rule.skills[i])} matches no current or base skill.`,
				);
			}
		}
		return {
			paths: rule.paths.map(compilePattern),
			consumers: current.filter((skill) => patterns.some((p) => p.test(skill))),
		};
	});
	const selected = new Map<string, SelectionReason[]>();
	const ignoredPaths: string[] = [];
	const add = (skill: string, type: SelectionReason["type"], file: string) => {
		const reasons = selected.get(skill) ?? [];
		if (!reasons.some((reason) => reason.type === type && reason.path === file))
			reasons.push({ type, path: file });
		selected.set(skill, reasons);
	};
	const files = [
		...new Set(
			input.changes.flatMap((change) =>
				change.oldPath ? [change.oldPath, change.path] : [change.path],
			),
		),
	].sort();
	for (const file of files) {
		let mapped = false;
		for (const skill of current) {
			// Removing an enclosing SKILL.md can expose unchanged nested skills.
			const exposedByRemoval = previous.some(
				(old) => !current.includes(old) && under(file, old) && under(skill, old),
			);
			if (under(file, skill) || exposedByRemoval) {
				add(skill, "direct", file);
				mapped = true;
			}
		}
		for (const dependency of dependencies) {
			if (dependency.paths.some((p) => p.test(file))) {
				mapped = true;
				for (const skill of dependency.consumers) add(skill, "dependency", file);
			}
		}
		if (file === input.configPath || globals.some((p) => p.test(file))) {
			mapped = true;
			for (const skill of current) add(skill, "global", file);
		}
		if (mapped || previous.some((skill) => under(file, skill))) continue;
		if (ignores.some((p) => p.test(file))) {
			ignoredPaths.push(file);
			continue;
		}
		for (const skill of current) add(skill, "unmapped", file);
	}
	return {
		selected: [...selected]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([skill, reasons]) => ({ path: skill, reasons })),
		removed: previous.filter((skill) => !current.includes(skill)).sort(),
		ignoredPaths,
	};
}

function checkLinks(repoRoot: string, directory: string): void {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if ([".git", "node_modules", ".skillet-evals"].includes(entry.name)) continue;
		const file = path.join(directory, entry.name);
		if (entry.isSymbolicLink()) assertInRepository(repoRoot, file);
		else if (entry.isDirectory()) checkLinks(repoRoot, file);
	}
}

export function planChangedSkills(
	ref: string,
	configPath?: string,
	evalsOverride?: string,
): { repoRoot: string; selection: SkillSelection } {
	const config = loadStructuralConfig(configPath, Boolean(configPath));
	const git = collectGitChanges(ref);
	assertInRepository(git.repoRoot, config.configPath);
	if (evalsOverride) assertInRepository(git.repoRoot, evalsOverride);
	for (const mock of Object.values(config.fileConfig?.mocks ?? {})) {
		for (const source of [mock.openapi, mock.mcpServer]
			.flat()
			.filter((value): value is string => Boolean(value))) {
			if (!/^https?:\/\//i.test(source))
				assertInRepository(git.repoRoot, path.resolve(config.configDir, source));
		}
	}
	const roots = config.skillRoots;
	if (!roots.length)
		throw new Error('Changed mode requires configured "skills.roots". No evaluations started.');
	for (const root of roots) {
		assertInRepository(git.repoRoot, root);
		const rel = relative(git.repoRoot, root);
		if (!fs.existsSync(root) && !git.baseFiles.some((file) => under(file, rel))) {
			throw new Error(`Skill root ${JSON.stringify(rel)} exists neither now nor at the base.`);
		}
		if (fs.existsSync(root)) {
			if (!fs.statSync(root).isDirectory())
				throw new Error(`Skill root is not a directory: ${rel}`);
			checkLinks(git.repoRoot, root);
		}
	}
	const current = discoverSkillsFromRoots(roots).map((file) => relative(git.repoRoot, file));
	const rootPaths = roots.map((root) => relative(git.repoRoot, root));
	// Apply the same stop-at-SKILL.md discovery independently to each configured root.
	const previous = [
		...new Set(
			rootPaths.flatMap((root) => {
				const found = git.baseFiles
					.filter((file) => path.posix.basename(file) === "SKILL.md" && under(file, root))
					.map((file) => path.posix.dirname(file))
					.filter(
						(file) =>
							!path.posix
								.relative(root, file)
								.split("/")
								.some((part) => [".git", "node_modules", ".skillet-evals"].includes(part)),
					);
				return found.filter(
					(skill) => !found.some((parent) => parent !== skill && under(skill, parent)),
				);
			}),
		),
	];
	if (!current.length && !previous.length)
		throw new Error('No skills discovered. Check "skills.roots". No evaluations started.');
	const classified = selectAffectedSkills({
		changes: git.changedPaths,
		current,
		previous,
		configPath: relative(git.repoRoot, config.configPath),
		rules: config.fileConfig?.changes,
	});
	const unrunnable = classified.selected
		.filter(
			(skill) =>
				!fs.existsSync(
					resolveSkillPaths(path.join(git.repoRoot, skill.path), evalsOverride).evalsFile,
				),
		)
		.map((skill) => ({ path: skill.path, reason: "evals.json not found" }));
	return {
		repoRoot: git.repoRoot,
		selection: {
			schemaVersion: 1,
			mode: "changed",
			requestedRef: git.requestedRef,
			baseCommit: git.baseCommit,
			headCommit: git.headCommit,
			mergeBaseCommit: git.mergeBaseCommit,
			localChanges: git.localChanges,
			changedPaths: git.changedPaths,
			discoveredCount: current.length,
			...classified,
			unrunnable,
			status: classified.selected.length > unrunnable.length ? "selected" : "no-runnable-skills",
		},
	};
}

export function printSelection(selection: SkillSelection): void {
	console.log(`\nChanged-skill selection since ${JSON.stringify(selection.requestedRef)}`);
	console.log(
		`  Base: ${selection.baseCommit}\n  HEAD: ${selection.headCommit}\n  Merge base: ${selection.mergeBaseCommit}`,
	);
	console.log(`  Local changes: ${selection.localChanges ? "included" : "none"}`);
	console.log(
		`  Discovered: ${selection.discoveredCount}; selected: ${selection.selected.length}; skipped without evals: ${selection.unrunnable.length}`,
	);
	if (
		selection.selected.some((skill) =>
			skill.reasons.some((reason) => reason.type === "global" || reason.type === "unmapped"),
		)
	) {
		console.log("  All current skills selected by global or unmapped inputs.");
	}
	for (const skill of selection.selected) {
		console.log(`  ${JSON.stringify(skill.path)}`);
		for (const reason of skill.reasons)
			console.log(`    ${reason.type}: ${JSON.stringify(reason.path)}`);
	}
	for (const skill of selection.removed) console.log(`  Removed: ${JSON.stringify(skill)}`);
	for (const skill of selection.unrunnable)
		console.log(`  Skipped: ${JSON.stringify(skill.path)} (${skill.reason})`);
	for (const file of selection.ignoredPaths) console.log(`  Ignored: ${JSON.stringify(file)}`);
}
