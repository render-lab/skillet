import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "../../src/eval/config/schema.js";
import type { ChatResponse } from "../../src/eval/providers/types.js";
import { BenchmarkFileSchema } from "../../src/eval/schemas/benchmark.js";
import { EvalCaseSchema } from "../../src/eval/schemas/evals.js";

const { chat, grade } = vi.hoisted(() => ({ chat: vi.fn(), grade: vi.fn() }));
vi.mock("../../src/eval/providers/factory.js", () => ({
	createProvider: () => ({ name: "test", modelId: "test-model", chat }),
}));
vi.mock("../../src/eval/grader/grader.js", () => ({ gradeRun: grade }));
import { runOrchestrator } from "../../src/eval/runner/orchestrator.js";

const config: ResolvedConfig = {
	providers: [{ name: "openai", model: "test-model", apiKey: "test" }],
	grader: { provider: "openai", model: "grader", apiKey: "test" },
	skillRoots: [],
	mocks: {},
	settings: { maxSteps: 3, timeout: 5, runsPerProvider: 1 },
};
const evalCase = EvalCaseSchema.parse({
	id: 1,
	prompt: "Do the task",
	expected_output: "Done",
	assertions: ["Does the task"],
});
function response(content: string, extra: Partial<ChatResponse> = {}): ChatResponse {
	return {
		content,
		usage: { inputTokens: 10, outputTokens: 0 },
		stopReason: "end",
		latencyMs: 12,
		...extra,
	};
}

describe("eval outcome classification", () => {
	let skill: string;
	beforeEach(() => {
		chat.mockReset();
		grade.mockReset();
		grade.mockResolvedValue({
			pass_rate: 1,
			passed: 1,
			failed: 0,
			total: 1,
			expectations: [{ text: "Does the task", passed: true, evidence: "done" }],
			claims: [],
			eval_feedback: null,
		});
		skill = fs.mkdtempSync(path.join(os.tmpdir(), "skillet-outcome-"));
		fs.writeFileSync(path.join(skill, "SKILL.md"), "skill");
	});
	afterEach(() => fs.rmSync(skill, { recursive: true, force: true }));

	it("records an empty response as ungraded with usage and provider stop reason, without calling the grader", async () => {
		chat.mockResolvedValue(response("  ", { providerStopReason: "refusal" }));
		const result = await runOrchestrator(config, [evalCase], skill, "skill", { concurrency: 1 });
		expect(grade).not.toHaveBeenCalled();
		expect(result.runs[0]).toMatchObject({
			error_kind: "empty_response",
			provider_stop_reason: "refusal",
			expectations: [],
			result: { passed: 0, failed: 0, total: 0, input_tokens: 10, output_tokens: 0, errors: 1 },
		});
		expect(result.runs[0]?.error).toContain("not graded");
		expect(chat).toHaveBeenCalledTimes(1);
		const parsed = BenchmarkFileSchema.parse({
			metadata: {
				skill_name: "test",
				skill_path: skill,
				timestamp: "now",
				evals_run: [1],
				runs_per_provider: 1,
				providers: [],
				grader: { name: "test", model: "test" },
			},
			runs: result.runs,
			provider_summary: result.providerSummary,
		});
		expect(parsed.runs[0]?.error_kind).toBe("empty_response");
	});

	it("grades a textual refusal normally and excludes empty responses from behavioral averages", async () => {
		chat.mockResolvedValueOnce(response("")).mockResolvedValueOnce(response("I cannot do that."));
		const result = await runOrchestrator(
			config,
			[evalCase, { ...evalCase, id: 2 }],
			skill,
			"skill",
			{ concurrency: 1 },
		);
		expect(grade).toHaveBeenCalledTimes(1);
		expect(result.runs[1]?.error).toBeNull();
		expect(result.providerSummary["test-model"]?.pass_rate.mean).toBe(1);
	});

	it("grades observable tool actions even when the final text is empty", async () => {
		chat
			.mockResolvedValueOnce(
				response("", {
					stopReason: "tool_use",
					toolCalls: [
						{ id: "1", name: "write_file", arguments: { path: "answer.txt", content: "done" } },
					],
				}),
			)
			.mockResolvedValueOnce(response(""));
		const result = await runOrchestrator(config, [evalCase], skill, "skill", { concurrency: 1 });
		expect(grade).toHaveBeenCalledTimes(1);
		expect(grade.mock.calls[0]?.[3]).toEqual([{ path: "answer.txt", content: "done" }]);
		expect(result.runs[0]?.error).toBeNull();
	});
});
