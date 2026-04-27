import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runOrchestratorMock } = vi.hoisted(() => ({
	runOrchestratorMock: vi.fn(),
}));

vi.mock("../../src/eval/runner/orchestrator.js", () => ({
	runOrchestrator: runOrchestratorMock,
}));

import { runRun } from "../../src/eval/commands/run.js";
import { runValidate } from "../../src/eval/commands/validate.js";

async function createSkill(rootDir: string, name: string, version?: string) {
	const skillDir = path.join(rootDir, name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		path.join(skillDir, "SKILL.md"),
		[
			"---",
			`name: ${name}`,
			...(version ? [`version: ${version}`] : []),
			"---",
			"",
			`# ${name}`,
			"",
			"Do the task.",
			"",
		].join("\n"),
	);
	await writeFile(
		path.join(skillDir, "evals.json"),
		`${JSON.stringify(
			{
				skill_name: name,
				evals: [
					{
						id: 1,
						prompt: "Do the task.",
						expected_output: "Task completed.",
						files: [],
						assertions: ["The task is completed"],
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	return skillDir;
}

function makeResult() {
	return {
		runs: [
			{
				eval_id: 1,
				provider: "openai",
				model: "gpt-5.4",
				run_number: 1,
				result: {
					pass_rate: 1,
					passed: 1,
					failed: 0,
					total: 1,
					time_seconds: 0.5,
					input_tokens: 10,
					output_tokens: 5,
					total_tokens: 15,
					tool_calls: 0,
					errors: 0,
					cost_usd: 0.001,
				},
				expectations: [{ text: "The task is completed", passed: true, evidence: "done" }],
				claims: [],
				eval_feedback: null,
				error: null,
			},
		],
		providerSummary: {
			"gpt-5.4": {
				pass_rate: { mean: 1, stddev: 0 },
				time_seconds: { mean: 0.5, stddev: 0 },
				total_tokens: { mean: 15, stddev: 0 },
				cost_usd: { mean: 0.001, stddev: 0 },
			},
		},
	};
}

describe("multi-skill eval commands", () => {
	let tmpDir: string;
	let originalCwd: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-eval-multi-"));
		originalCwd = process.cwd();
		originalEnv = { ...process.env };
		process.chdir(tmpDir);
		process.env.OPENAI_API_KEY = "test-openai-key";
		await writeFile(path.join(tmpDir, "package.json"), '{ "name": "test-project" }\n');
		runOrchestratorMock.mockReset();
		runOrchestratorMock.mockResolvedValue(makeResult());
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		process.chdir(originalCwd);
		for (const key of Object.keys(process.env)) {
			delete process.env[key];
		}
		Object.assign(process.env, originalEnv);
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("validates all provided skills before exiting", async () => {
		const skillA = await createSkill(tmpDir, "skill-a");
		const skillB = path.join(tmpDir, "skill-b");
		await mkdir(skillB, { recursive: true });
		await writeFile(path.join(skillB, "SKILL.md"), "# skill-b\n");

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`exit:${code}`);
		}) as never);

		await expect(runValidate({ skills: [skillA, skillB] })).rejects.toThrow("exit:1");

		expect(exitSpy).toHaveBeenCalledWith(1);
		const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
		expect(logs).toContain("Validating 2 skill(s)");
		expect(logs).toContain(`[1/2] Skill: ${skillA}`);
		expect(logs).toContain(`[2/2] Skill: ${skillB}`);
		expect(logs).toContain("evals.json valid");
		expect(logs).toContain("evals.json not found");
	});

	it("runs evals for each provided skill and writes separate result folders", async () => {
		const skillA = await createSkill(tmpDir, "skill-a", "1.2.3");
		const skillB = await createSkill(tmpDir, "skill-b");

		await runRun({
			skills: [skillA, skillB],
			runs: "1",
			timeout: "5",
		});

		expect(runOrchestratorMock).toHaveBeenCalledTimes(2);
		expect(runOrchestratorMock.mock.calls[0]?.[2]).toBe(skillA);
		expect(runOrchestratorMock.mock.calls[1]?.[2]).toBe(skillB);
		const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
		expect(logs).toContain("Multi-skill eval run");
		expect(logs).toContain("Skills:    2");
		expect(logs).toContain(`[1/2] Skill: ${skillA}`);
		expect(logs).toContain(`[2/2] Skill: ${skillB}`);
		expect(logs).toContain("Multi-skill summary");
		expect(logs).toContain("Skills:     2 total");
		expect(logs).toContain("Succeeded:  2");
		expect(logs).toContain("Failed:     0");
		expect(logs).toContain("Evals:      2 across successful skills");
		expect(logs).toContain("Runs:       2 total eval run(s)");

		const resultDirs = await readdir(path.join(tmpDir, ".skillet-evals", "results"));
		expect(resultDirs.sort()).toEqual(["skill-a", "skill-b"]);
		const skillAFiles = await readdir(path.join(tmpDir, ".skillet-evals", "results", "skill-a"));
		const jsonFile = skillAFiles.find((file) => file.endsWith(".json"));
		expect(jsonFile).toBeDefined();
		const benchmark = JSON.parse(
			await readFile(
				path.join(tmpDir, ".skillet-evals", "results", "skill-a", jsonFile ?? ""),
				"utf-8",
			),
		);
		expect(benchmark.metadata.skill_version).toBe("1.2.3");
		expect(benchmark.metadata.skill_sha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it("discovers all configured skills for validate and run when none are passed", async () => {
		const skillA = await createSkill(tmpDir, "fixtures/skills/skill-a");
		const skillB = await createSkill(tmpDir, "fixtures/skills/skill-b");
		const configPath = path.join(tmpDir, "skillet.eval.yaml");
		await writeFile(
			configPath,
			[
				"providers:",
				"  - name: openai",
				"    model: gpt-5.4",
				"    apiKey: ${OPENAI_API_KEY}",
				"skills:",
				"  roots:",
				"    - ./fixtures/skills",
				"",
			].join("\n"),
		);

		await runValidate({ config: configPath });
		await runRun({
			config: configPath,
			runs: "1",
			timeout: "5",
		});

		const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
		expect(logs).toContain(`Skill: ${skillA}`);
		expect(logs).toContain(`Skill: ${skillB}`);
		expect(runOrchestratorMock).toHaveBeenCalledTimes(2);
	});

	it("continues across skills and exits once if any run fails", async () => {
		const skillA = await createSkill(tmpDir, "skill-a");
		const missingSkill = path.join(tmpDir, "skill-missing");

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`exit:${code}`);
		}) as never);

		await expect(
			runRun({
				skills: [skillA, missingSkill],
				runs: "1",
				timeout: "5",
			}),
		).rejects.toThrow("exit:1");

		expect(runOrchestratorMock).toHaveBeenCalledTimes(1);
		expect(exitSpy).toHaveBeenCalledWith(1);
		const errors = vi.mocked(console.error).mock.calls.flat().join("\n");
		expect(errors).toContain("SKILL.md not found");
		expect(errors).toContain("One or more skill eval runs failed.");
	});

	it("rejects ambiguous shared overrides in multi-skill run mode", async () => {
		const skillA = await createSkill(tmpDir, "skill-a");
		const skillB = await createSkill(tmpDir, "skill-b");

		await expect(
			runRun({
				skills: [skillA, skillB],
				evals: path.join(skillA, "evals.json"),
			}),
		).rejects.toThrow("--evals can only be used when running a single skill.");
	});
});
