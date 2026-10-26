import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { orchestrator } = vi.hoisted(() => ({ orchestrator: vi.fn() }));
vi.mock("../../src/eval/runner/orchestrator.js", () => ({ runOrchestrator: orchestrator }));
import { runRun } from "../../src/eval/commands/run.js";
import {
	compilePattern,
	planChangedSkills,
	selectAffectedSkills,
} from "../../src/eval/config/changed-skills.js";
import { collectGitChanges } from "../../src/eval/config/git-changes.js";
import { loadConfig, loadStructuralConfig } from "../../src/eval/config/loader.js";
import { ConfigFileSchema } from "../../src/eval/config/schema.js";

let root: string;
let cwd: string;
let env: NodeJS.ProcessEnv;
const cleanup: string[] = [];
function git(...args: string[]) {
	return execFileSync(
		"git",
		["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
		{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
}
function write(file: string, content: string) {
	fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
	fs.writeFileSync(path.join(root, file), content);
}
function commit() {
	git("add", ".");
	git("commit", "-m", "test");
}
function skill(name: string, withEvals = true) {
	write(`skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n# ${name}\n`);
	if (withEvals)
		write(
			`skills/${name}/evals.json`,
			JSON.stringify({
				skill_name: name,
				evals: [1, 2].map((id) => ({
					id,
					prompt: `Task ${id}`,
					expected_output: "Completed",
					assertions: ["Completed"],
					files: [],
				})),
			}),
		);
}
function config(extra: Record<string, unknown> = {}) {
	write(
		"skillet.config.yaml",
		JSON.stringify({ providers: ["gpt-5.4"], skills: { roots: ["skills"] }, ...extra }),
	);
}
function selected() {
	return planChangedSkills("base").selection.selected.map((s) => s.path);
}
function classify(files: string[], rules = {}) {
	return selectAffectedSkills({
		changes: files.map((file) => ({ path: file, status: "M" })),
		current: ["skills/a", "skills/ab", "skills/b"],
		previous: ["skills/a", "skills/ab", "skills/b"],
		configPath: "custom.yaml",
		rules: ConfigFileSchema.parse({ providers: ["gpt-5.4"], changes: rules }).changes,
	});
}

beforeEach(() => {
	cwd = process.cwd();
	env = { ...process.env };
	for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"])
		delete process.env[name];
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skillet-changes-")));
	process.chdir(root);
	git("init", "-b", "main");
	git("config", "user.name", "Test");
	git("config", "user.email", "test@example.invalid");
	config();
	skill("a");
	skill("b");
	write(".gitignore", "ignored/\n.skillet-evals/\n");
	commit();
	git("tag", "base");
	orchestrator.mockReset();
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	process.chdir(cwd);
	process.env = env;
	fs.rmSync(root, { recursive: true, force: true });
	for (const item of cleanup.splice(0)) fs.rmSync(item, { recursive: true, force: true });
});

describe("path classification", () => {
	it.each([
		"SKILL.md",
		"references/nested/file.md",
		"fixtures/data.json",
		"scripts/run.sh",
		"evals/evals.json",
	])("selects the owner for %s without prefix collisions", (file) => {
		expect(classify([`skills/a/${file}`]).selected.map((s) => s.path)).toEqual(["skills/a"]);
	});
	it("unions dependency consumers, including sources in another skill", () => {
		const plan = classify(["skills/a/reference.md"], {
			dependencies: [{ paths: ["skills/a/**"], skills: ["skills/b"] }],
		});
		expect(plan.selected.map((s) => s.path)).toEqual(["skills/a", "skills/b"]);
		expect(plan.selected[1].reasons[0].type).toBe("dependency");
	});
	it("global and unmapped changes select all with different explanations", () => {
		for (const file of ["custom.yaml", "pnpm-lock.yaml", "requirements-dev.txt"])
			expect(classify([file]).selected.every((s) => s.reasons[0].type === "global")).toBe(true);
		expect(classify(["unknown/helper.ts"]).selected).toHaveLength(3);
		expect(classify(["unknown/helper.ts"]).selected[0].reasons[0].type).toBe("unmapped");
	});
	it("ignores only outside paths without higher-priority matches", () => {
		const plan = classify(["README.md", "skills/a/SKILL.md", "pnpm-lock.yaml", "shared/a.md"], {
			ignore: ["**"],
			dependencies: [{ paths: ["shared/**"], skills: ["skills/b"] }],
		});
		expect(plan.ignoredPaths).toEqual(["README.md"]);
		expect(
			plan.selected.find((s) => s.path === "skills/a")?.reasons.some((r) => r.type === "direct"),
		).toBe(true);
		expect(
			plan.selected
				.find((s) => s.path === "skills/b")
				?.reasons.some((r) => r.type === "dependency"),
		).toBe(true);
	});
	it("validates patterns and consumer mappings", () => {
		for (const pattern of ["../outside", "/abs", "!foo", "a/**b", "a\\b", "${HOME}", "a/[bc]", ""])
			expect(() => compilePattern(pattern)).toThrow("Invalid changes pattern");
		expect(() =>
			classify([], { dependencies: [{ paths: ["shared/**"], skills: ["skills/typo"] }] }),
		).toThrow("matches no current or base skill");
		expect(compilePattern("shared/**/*.md").test("shared/.hidden.md")).toBe(true);
		expect(compilePattern("shared/**/*.md").test("shared/sub/file.md")).toBe(true);
		expect(compilePattern("skills/*").test("skills/a/nested")).toBe(false);
	});
});

describe("Git selection", () => {
	it("includes committed, staged, unstaged and nonignored untracked files", () => {
		write("skills/a/references/committed.md", "new");
		commit();
		write("skills/a/staged.txt", "staged");
		git("add", "skills/a/staged.txt");
		write("skills/b/SKILL.md", "# changed");
		write("skills/b/new.txt", "new");
		write("ignored/no.txt", "ignored");
		const plan = planChangedSkills("base").selection;
		expect(plan.localChanges).toBe(true);
		expect(plan.selected.map((s) => s.path)).toEqual(["skills/a", "skills/b"]);
		expect(plan.changedPaths.map((s) => s.path)).toEqual(
			expect.arrayContaining([
				"skills/a/references/committed.md",
				"skills/a/staged.txt",
				"skills/b/SKILL.md",
				"skills/b/new.txt",
			]),
		);
		expect(plan.changedPaths.some((s) => s.path.startsWith("ignored/"))).toBe(false);
	});
	it("retains staged changes canceled by an unstaged edit", () => {
		const original = fs.readFileSync("skills/a/SKILL.md", "utf8");
		write("skills/a/SKILL.md", "# staged");
		git("add", ".");
		write("skills/a/SKILL.md", original);
		expect(selected()).toEqual(["skills/a"]);
	});
	it("tracks deleted files, whole skills, and renamed destinations", () => {
		fs.rmSync("skills/a/evals.json");
		git("mv", "skills/b", "skills/c");
		const plan = planChangedSkills("base").selection;
		expect(plan.selected.map((s) => s.path)).toEqual(["skills/a", "skills/c"]);
		expect(plan.removed).toEqual(["skills/b"]);
		expect(plan.unrunnable).toEqual([{ path: "skills/a", reason: "evals.json not found" }]);
		expect(plan.changedPaths.some((s) => s.oldPath === "skills/b/SKILL.md")).toBe(true);
	});
	it("reports removal of every skill without treating discovery as misconfigured", () => {
		fs.rmSync("skills", { recursive: true });
		const plan = planChangedSkills("base").selection;
		expect(plan.status).toBe("no-runnable-skills");
		expect(plan.removed).toEqual(["skills/a", "skills/b"]);
	});
	it("rejects typo roots and accepts new skills", () => {
		skill("new");
		expect(selected()).toEqual(["skills/new"]);
		config({ skills: { roots: ["typo"] } });
		expect(() => selected()).toThrow("neither now nor at the base");
	});
	it("excludes target-only commits using a merge base, including a merge checkout", () => {
		git("switch", "-c", "target");
		write("skills/b/reference.md", "target");
		commit();
		git("switch", "-c", "feature", "base");
		write("skills/a/reference.md", "feature");
		commit();
		expect(planChangedSkills("target").selection.selected.map((s) => s.path)).toEqual(["skills/a"]);
		git("merge", "target", "--no-edit");
		expect(planChangedSkills("target").selection.selected.map((s) => s.path)).toEqual(["skills/a"]);
	});
	it("handles nested invocation, custom config, flat precedence and nested evals", () => {
		write(
			"config/custom.yaml",
			JSON.stringify({ providers: ["gpt-5.4"], skills: { roots: ["../skills"] } }),
		);
		commit();
		git("tag", "nested-base");
		write("skills/a/evals/evals.json", "invalid ignored by flat precedence");
		process.chdir(path.join(root, "config"));
		expect(
			planChangedSkills("nested-base", "custom.yaml").selection.selected.map((s) => s.path),
		).toEqual(["skills/a"]);
	});
	it("handles worktrees and detached HEAD", () => {
		const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "skillet-worktree-"));
		cleanup.push(worktree);
		git("worktree", "add", "--detach", worktree, "HEAD");
		fs.writeFileSync(path.join(worktree, "skills/a/SKILL.md"), "# changed");
		process.chdir(worktree);
		expect(selected()).toEqual(["skills/a"]);
	});
	it("preserves Unicode, spaces and newlines in paths without executing helpers", () => {
		write("skills/a/é space\nfile.md", "changed");
		git("config", "diff.external", "touch SHOULD_NOT_EXIST");
		const plan = planChangedSkills("base").selection;
		expect(plan.changedPaths[0].path).toBe("skills/a/é space\nfile.md");
		expect(fs.existsSync("SHOULD_NOT_EXIST")).toBe(false);
	});
	it("rejects missing refs, option-like refs and shallow histories", () => {
		expect(() => collectGitChanges("missing")).toThrow("Cannot determine");
		expect(() => collectGitChanges("--help")).toThrow("Cannot determine");
		fs.writeFileSync(path.join(root, ".git/shallow"), `${git("rev-parse", "HEAD")}\n`);
		expect(() => collectGitChanges("base")).toThrow("full Git history");
	});
	it("rejects non-Git directories, escaping roots and symlinks", () => {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "skillet-outside-"));
		cleanup.push(outside);
		expect(() => collectGitChanges("HEAD", outside)).toThrow("Cannot determine");
		config({ skills: { roots: [outside] } });
		expect(() => selected()).toThrow("outside the Git repository");
		config();
		fs.symlinkSync(outside, "skills/a/external");
		expect(() => selected()).toThrow("symlink escaping");
	});
	it("does not lose consumers when the source skill is deleted", () => {
		config({ changes: { dependencies: [{ paths: ["skills/a/**"], skills: ["skills/b"] }] } });
		commit();
		git("tag", "mapped");
		fs.rmSync("skills/a", { recursive: true });
		const plan = planChangedSkills("mapped").selection;
		expect(plan.selected.map((s) => s.path)).toEqual(["skills/b"]);
		expect(plan.selected[0].reasons[0].type).toBe("dependency");
	});
});

describe("runner compatibility and no-call behavior", () => {
	it("loads structural configuration without credentials while preserving loadConfig errors", () => {
		expect(loadStructuralConfig().skillRoots).toEqual([path.join(root, "skills")]);
		expect(() => loadConfig()).toThrow("No providers configured");
	});
	it("previews selected skills and writes metadata without credentials", async () => {
		write("skills/a/ref.md", "change");
		await runRun({
			changedSince: "base",
			dryRun: true,
			selectionOutput: ".skillet-evals/selection.json",
		});
		expect(orchestrator).not.toHaveBeenCalled();
		const artifact = JSON.parse(fs.readFileSync(".skillet-evals/selection.json", "utf8"));
		expect(artifact.schemaVersion).toBe(1);
		expect(artifact.selected[0].path).toBe("skills/a");
		expect(JSON.stringify(artifact)).not.toContain(root);
		expect(artifact.providers).toBeUndefined();
	});
	it("returns a successful empty selection without keys, outputs or calls", async () => {
		await runRun({ changedSince: "base" });
		expect(orchestrator).not.toHaveBeenCalled();
		expect(fs.existsSync(".skillet-evals")).toBe(false);
		expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain(
			"No affected runnable skills",
		);
	});
	it("skips a single skill without evals in changed mode", async () => {
		skill("no-evals", false);
		await runRun({ changedSince: "base" });
		expect(orchestrator).not.toHaveBeenCalled();
		expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("Skipped:");
	});
	it("preflights malformed eval files before any model execution", async () => {
		write("skills/a/ref.md", "changed");
		write("skills/b/evals.json", "{");
		await expect(runRun({ changedSince: "base" })).rejects.toThrow();
		expect(orchestrator).not.toHaveBeenCalled();
	});
	it("rejects option conflicts before execution", async () => {
		await expect(runRun({ dryRun: true })).rejects.toThrow("require --changed-since");
		await expect(runRun({ selectionOutput: "out.json" })).rejects.toThrow(
			"require --changed-since",
		);
		await expect(runRun({ changedSince: "base", skills: ["skills/a"] })).rejects.toThrow(
			"cannot be combined",
		);
		write("skills/a/ref.md", "a");
		write("skills/b/ref.md", "b");
		await expect(runRun({ changedSince: "base", golden: "golden.json" })).rejects.toThrow(
			"single skill",
		);
		await expect(runRun({ changedSince: "base", evals: "skills/a/evals.json" })).rejects.toThrow(
			"single skill",
		);
		expect(orchestrator).not.toHaveBeenCalled();
	});
	it("hands only selected skills and explicitly filtered cases to the existing runner", async () => {
		process.env.OPENAI_API_KEY = "test-only";
		write("skills/a/ref.md", "a");
		orchestrator.mockRejectedValue(new Error("intentional runner failure"));
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		await expect(
			runRun({
				changedSince: "base",
				evalId: "2",
				providers: "openai",
				selectionOutput: ".skillet-evals/selection.json",
			}),
		).rejects.toThrow("exit");
		expect(orchestrator).toHaveBeenCalledTimes(1);
		expect(orchestrator.mock.calls[0][1].map((e: { id: number }) => e.id)).toEqual([2]);
		expect(orchestrator.mock.calls[0][2]).toBe(path.join(root, "skills/a"));
		expect(fs.existsSync(".skillet-evals/selection.json")).toBe(true);
	});
});

describe("adoption scenarios", () => {
	it("runs mapped shared consumers even when generated copies are unchanged", () => {
		config({ changes: { dependencies: [{ paths: ["shared/guide.md"], skills: ["skills/a"] }] } });
		write("shared/guide.md", "old");
		commit();
		git("tag", "shared-base");
		write("shared/guide.md", "new");
		const selection = planChangedSkills("shared-base").selection;
		expect(selection.selected.map((skill) => skill.path)).toEqual(["skills/a"]);
		expect(selection.selected[0].reasons).toEqual([
			{ type: "dependency", path: "shared/guide.md" },
		]);
	});
	it("skips an explicitly ignored docs-only change without keys", async () => {
		config({ changes: { ignore: ["docs/**"] } });
		commit();
		git("tag", "docs-base");
		write("docs/guide.md", "prose");
		await runRun({ changedSince: "docs-base", selectionOutput: ".skillet-evals/selection.json" });
		expect(orchestrator).not.toHaveBeenCalled();
		const selection = JSON.parse(fs.readFileSync(".skillet-evals/selection.json", "utf8"));
		expect(selection.selected).toEqual([]);
		expect(selection.ignoredPaths).toEqual(["docs/guide.md"]);
	});
	it("rejects empty refs and selected fixtures outside the repository", async () => {
		await expect(runRun({ changedSince: "" })).rejects.toThrow("nonempty Git ref");
		await expect(runRun({ changedSince: "  " })).rejects.toThrow("nonempty Git ref");
		const evals = JSON.parse(fs.readFileSync("skills/a/evals.json", "utf8"));
		evals.evals[0].files = ["../../../outside.txt"];
		write("skills/a/evals.json", JSON.stringify(evals));
		await expect(runRun({ changedSince: "base", dryRun: true })).rejects.toThrow(
			"outside the Git repository",
		);
		expect(orchestrator).not.toHaveBeenCalled();
	});
	it("rejects external local mock inputs without fetching remote mocks", () => {
		config({ mocks: { external: { openapi: "../outside.json" } } });
		expect(() => selected()).toThrow("outside the Git repository");
		config({ mocks: { external: { openapi: "https://example.invalid/spec.json" } } });
		expect(selected()).toEqual(["skills/a", "skills/b"]);
	});
	it("matches newline-containing glob segments without treating newline suffixes as equal", () => {
		expect(compilePattern("skills/**").test("skills/new\nname")).toBe(true);
		expect(compilePattern("README.md").test("README.md\n")).toBe(false);
	});
	it("successfully evaluates the selected full suite with the existing benchmark format", async () => {
		process.env.OPENAI_API_KEY = "test-only";
		write("skills/a/ref.md", "a");
		orchestrator.mockResolvedValue({
			runs: [1, 2].map((id) => ({
				eval_id: id,
				provider: "openai",
				model: "gpt-5.4",
				run_number: 1,
				result: {
					pass_rate: 1,
					passed: 1,
					failed: 0,
					total: 1,
					time_seconds: 0.1,
					input_tokens: 1,
					output_tokens: 1,
					total_tokens: 2,
					tool_calls: 0,
					errors: 0,
					cost_usd: 0,
				},
				expectations: [{ text: "Completed", passed: true, evidence: "done" }],
				claims: [],
				eval_feedback: null,
				error: null,
			})),
			providerSummary: {
				"gpt-5.4": {
					pass_rate: { mean: 1, stddev: 0 },
					time_seconds: { mean: 0.1, stddev: 0 },
					total_tokens: { mean: 2, stddev: 0 },
					cost_usd: { mean: 0, stddev: 0 },
				},
			},
		});
		await runRun({ changedSince: "base", providers: "openai" });
		expect(orchestrator).toHaveBeenCalledTimes(1);
		expect(orchestrator.mock.calls[0][1].map((e: { id: number }) => e.id)).toEqual([1, 2]);
		const results = path.join(root, ".skillet-evals/results/a");
		const file = fs
			.readdirSync(results)
			.find((name) => name.endsWith(".json") && !name.endsWith(".manifest.json"));
		expect(file).toBeDefined();
		const benchmark = JSON.parse(fs.readFileSync(path.join(results, file ?? ""), "utf8"));
		expect(benchmark.metadata.skill_name).toBe("a");
		expect(benchmark.runs).toHaveLength(2);
		expect(benchmark.schemaVersion).toBeUndefined();
		expect(fs.existsSync(".skillet-evals/results/b")).toBe(false);
	});
});

describe("discovery transitions", () => {
	it("selects newly exposed nested skills when an enclosing SKILL.md is removed", () => {
		write("skills/a/nested/SKILL.md", "# nested");
		write("skills/a/nested/evals.json", fs.readFileSync("skills/a/evals.json", "utf8"));
		commit();
		git("tag", "enclosing");
		fs.rmSync("skills/a/SKILL.md");
		const selection = planChangedSkills("enclosing").selection;
		expect(selection.selected.map((skill) => skill.path)).toEqual(["skills/a/nested"]);
		expect(selection.removed).toEqual(["skills/a"]);
	});
	it("keeps explicitly configured nested roots in base discovery", () => {
		write("skills/a/nested/SKILL.md", "# nested");
		config({ skills: { roots: ["skills", "skills/a/nested"] } });
		commit();
		git("tag", "roots");
		fs.rmSync("skills/a/nested", { recursive: true });
		expect(planChangedSkills("roots").selection.removed).toEqual(["skills/a/nested"]);
	});
});
