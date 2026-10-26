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
import * as pricing from "../../src/eval/providers/pricing.js";
import { printResults } from "../../src/eval/report/console-reporter.js";
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
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		fs.rmSync(skill, { recursive: true, force: true });
	});

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

describe("timeouts preserve evidence without grading incomplete runs", () => {
	let skill: string;
	beforeEach(() => {
		vi.spyOn(pricing, "estimateCost").mockImplementation(
			(_model, input, output) => (input + 2 * output) / 1_000_000,
		);
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
		});
		chat.mockReset();
		grade.mockReset();
		grade.mockResolvedValue({
			pass_rate: 1,
			passed: 1,
			failed: 0,
			total: 1,
			expectations: [],
			claims: [],
			eval_feedback: null,
		});
		skill = fs.mkdtempSync(path.join(os.tmpdir(), "skillet-timeout-"));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		fs.rmSync(skill, { recursive: true, force: true });
	});

	it.each([
		{ timeout: 5, elapsed: 5000, label: "overall eval" },
		{ timeout: 300, elapsed: 120000, label: "provider call" },
	])(
		"classifies a $label timeout, retains prior usage, and prevents late tool execution",
		async ({ timeout, elapsed }) => {
			let resolveLate!: (value: ChatResponse) => void;
			chat
				.mockResolvedValueOnce(
					response("Inspecting", {
						stopReason: "tool_use",
						usage: { inputTokens: 20, outputTokens: 5 },
						toolCalls: [{ id: "1", name: "unavailable_tool", arguments: {} }],
					}),
				)
				.mockImplementationOnce(
					() =>
						new Promise<ChatResponse>((resolve) => {
							resolveLate = resolve;
						}),
				)
				.mockResolvedValueOnce(response("Done"));
			const running = runOrchestrator(
				{ ...config, settings: { ...config.settings, timeout } },
				[evalCase, { ...evalCase, id: 2 }],
				skill,
				"skill",
				{ concurrency: 1 },
			);
			await vi.advanceTimersByTimeAsync(elapsed);
			const result = await running;
			const timedOut = result.runs[0];
			expect(timedOut).toMatchObject({
				error_kind: "timeout",
				expectations: [],
				result: {
					passed: 0,
					failed: 0,
					total: 0,
					time_seconds: elapsed / 1000,
					input_tokens: 20,
					output_tokens: 5,
					total_tokens: 25,
					tool_calls: 1,
					errors: 2,
				},
			});
			expect(timedOut?.error).toContain("timed out");
			expect(timedOut?.result.cost_usd).toBeCloseTo(0.00003);
			expect(result.providerSummary["test-model"]?.pass_rate.mean).toBe(1);
			expect(grade).toHaveBeenCalledTimes(1);
			const lateFile = path.join(skill, "late.txt");
			resolveLate(
				response("Late tool", {
					stopReason: "tool_use",
					toolCalls: [
						{
							id: "late",
							name: "write_file",
							arguments: { path: lateFile, content: "must not run" },
						},
					],
				}),
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(fs.existsSync(lateFile)).toBe(false);
			expect(chat).toHaveBeenCalledTimes(3);
			expect(grade).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			printResults(result, [evalCase], 1);
			const output = log.mock.calls.flat().join("\n");
			expect(output).toContain("ungraded (timeout)");
			expect(output).toContain("1 timeout(s)");
			expect(output).not.toContain("0/0 passed");
		},
	);

	it("retains completed agent usage when grading exceeds the overall deadline", async () => {
		chat.mockResolvedValue(response("Done", { usage: { inputTokens: 30, outputTokens: 8 } }));
		grade.mockImplementation(() => new Promise(() => {}));
		const running = runOrchestrator(config, [evalCase], skill, "skill", { concurrency: 1 });
		await vi.advanceTimersByTimeAsync(5000);
		const result = await running;
		expect(result.runs[0]).toMatchObject({
			error_kind: "timeout",
			expectations: [],
			result: { total: 0, failed: 0, time_seconds: 5, total_tokens: 38 },
		});
		expect(result.runs[0]?.error).toContain("grading");
		expect(vi.getTimerCount()).toBe(0);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		printResults(result, [evalCase], 1);
		expect(log.mock.calls.flat().join("\n")).toContain("Ungraded overall");
	});
});
