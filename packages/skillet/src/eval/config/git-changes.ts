import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ChangedPath {
	path: string;
	status: string;
	oldPath?: string;
}

export interface GitChanges {
	repoRoot: string;
	requestedRef: string;
	baseCommit: string;
	headCommit: string;
	mergeBaseCommit: string;
	localChanges: boolean;
	changedPaths: ChangedPath[];
	baseFiles: string[];
}

function git(cwd: string, args: string[]): string {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		throw new Error(
			"Cannot determine changed skills from Git. Verify the ref and repository, and fetch the base and full history (for CI, use fetch-depth: 0). No evaluations started.",
		);
	}
}

function parseChanges(output: string): ChangedPath[] {
	const fields = output.split("\0");
	const changes: ChangedPath[] = [];
	for (let i = 0; i < fields.length && fields[i]; ) {
		const status = fields[i++];
		const first = fields[i++];
		if (status.startsWith("R") || status.startsWith("C")) {
			changes.push({ status, oldPath: first, path: fields[i++] });
		} else {
			changes.push({ status, path: first });
		}
	}
	return changes;
}

/** Collect paths only; never invoke user diff helpers or check out historical files. */
export function collectGitChanges(ref: string, cwd = process.cwd()): GitChanges {
	const repoRoot = git(cwd, ["rev-parse", "--show-toplevel"]).replace(/\n$/, "");
	const baseCommit = git(repoRoot, [
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${ref}^{commit}`,
	]).trim();
	const headCommit = git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
	// A merge base in truncated history may not be the actual branch point.
	if (git(repoRoot, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
		throw new Error(
			"Changed-skill selection requires full Git history. Fetch with --unshallow or use fetch-depth: 0. No evaluations started.",
		);
	}
	const mergeBases = git(repoRoot, ["merge-base", "--all", baseCommit, headCommit])
		.trim()
		.split("\n");
	if (mergeBases.length !== 1 || !mergeBases[0]) {
		throw new Error(
			"Cannot select a unique Git merge base. Run the full suite instead. No evaluations started.",
		);
	}
	const mergeBaseCommit = mergeBases[0];
	const diffArgs = [
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--ignore-submodules=none",
		"--name-status",
		"-z",
		"-M",
	];
	const committed = parseChanges(git(repoRoot, [...diffArgs, mergeBaseCommit, headCommit, "--"]));
	// Separate staged/unstaged diffs retain paths even when edits cancel each other out.
	const staged = parseChanges(git(repoRoot, [...diffArgs, "--cached", headCommit, "--"]));
	const unstaged = parseChanges(git(repoRoot, [...diffArgs, "--"]));
	const untracked = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
		.split("\0")
		.filter(Boolean)
		.map((file) => ({ path: file, status: "?" }));
	const unique = new Map<string, ChangedPath>();
	for (const change of [...committed, ...staged, ...unstaged, ...untracked]) {
		unique.set(JSON.stringify(change), change);
	}
	return {
		repoRoot,
		requestedRef: ref,
		baseCommit,
		headCommit,
		mergeBaseCommit,
		localChanges: staged.length + unstaged.length + untracked.length > 0,
		changedPaths: [...unique.values()].sort(
			(a, b) => a.path.localeCompare(b.path) || a.status.localeCompare(b.status),
		),
		baseFiles: git(repoRoot, ["ls-tree", "-r", "--name-only", "-z", mergeBaseCommit])
			.split("\0")
			.filter(Boolean),
	};
}

export function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
	);
}

/** Resolve the nearest existing ancestor, so deleted inputs still have a boundary check. */
export function assertInRepository(repoRoot: string, input: string): void {
	const absolute = path.resolve(input);
	if (!isWithin(repoRoot, absolute)) {
		throw new Error(
			`Changed mode cannot track input outside the Git repository: ${input}. Use an unfiltered run.`,
		);
	}
	let existing = absolute;
	while (
		!fs.existsSync(existing) &&
		!fs.lstatSync(existing, { throwIfNoEntry: false })?.isSymbolicLink()
	) {
		const parent = path.dirname(existing);
		if (parent === existing) break;
		existing = parent;
	}
	let real: string;
	try {
		real = fs.realpathSync(existing);
	} catch {
		throw new Error(`Cannot resolve changed-mode input: ${input}. Check for broken symlinks.`);
	}
	if (!isWithin(fs.realpathSync(repoRoot), real)) {
		throw new Error(
			`Changed mode cannot track a symlink escaping the Git repository: ${input}. Use an unfiltered run.`,
		);
	}
}
