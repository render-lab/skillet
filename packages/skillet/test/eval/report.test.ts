import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReport } from "../../src/eval/commands/report.js";

function makeBenchmark(skillName: string) {
	return {
		metadata: {
			skill_name: skillName,
			skill_path: `skills/${skillName}`,
			timestamp: "2026-04-27T12:00:00.000Z",
			evals_run: [1],
			runs_per_provider: 1,
			providers: [{ name: "openai", model: "gpt-5.4" }],
			grader: { name: "openai", model: "gpt-5.4" },
		},
		runs: [
			{
				eval_id: 1,
				provider: "openai",
				model: "gpt-5.4",
				run_number: 1,
				result: {
					pass_rate: 1,
					passed: 2,
					failed: 0,
					total: 2,
					time_seconds: 0.5,
					input_tokens: 1,
					output_tokens: 1,
					total_tokens: 2,
					tool_calls: 0,
					errors: 0,
					cost_usd: 0.001,
				},
				expectations: [{ text: "does the task", passed: true, evidence: "done" }],
				claims: [],
				eval_feedback: null,
				error: null,
			},
		],
		provider_summary: {
			"gpt-5.4": {
				pass_rate: { mean: 1, stddev: 0 },
				time_seconds: { mean: 0.5, stddev: 0 },
				total_tokens: { mean: 2, stddev: 0 },
				cost_usd: { mean: 0.001, stddev: 0 },
			},
		},
		notes: [],
	};
}

describe("runReport", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-report-"));
		originalCwd = process.cwd();
		process.chdir(tmpDir);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await writeFile(path.join(tmpDir, "package.json"), '{ "name": "test-project" }\n');
		const resultDir = path.join(tmpDir, ".skillet-evals/results/skill-a");
		await mkdir(resultDir, { recursive: true });
		await writeFile(
			path.join(resultDir, "2026-04-27T12-00-00.json"),
			`${JSON.stringify(makeBenchmark("skill-a"))}\n`,
		);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		process.chdir(originalCwd);
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("writes a standalone static HTML report", async () => {
		runReport({ skill: tmpDir });

		const report = await readFile(path.join(tmpDir, ".skillet-evals/report/index.html"), "utf-8");

		expect(report).toContain("Skillet Eval Report");
		expect(report).toContain("skill-a");
		expect(report).toContain("100%");
		expect(report).toContain("gpt-5.4");
	});
});
