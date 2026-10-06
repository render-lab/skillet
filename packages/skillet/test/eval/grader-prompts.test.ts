import { describe, expect, it } from "vitest";
import { buildGradingPrompt } from "../../src/eval/grader/prompts.js";
import type { AgentRun, TranscriptStep } from "../../src/eval/runner/transcript.js";
import type { EvalCase } from "../../src/eval/schemas/evals.js";

const evalCase: EvalCase = {
	id: 1,
	prompt: "Why are my tasks missing?",
	expected_output: "Explains the likely causes.",
	files: [],
	mocks: {},
	assertions: ["Mentions RENDER_API_KEY"],
};

function step(n: number, response: string, turn?: number): TranscriptStep {
	return {
		step: n,
		turn,
		response,
		toolResults: [],
		usage: { inputTokens: 0, outputTokens: 0 },
		latencyMs: 0,
	};
}

function run(transcript: TranscriptStep[]): AgentRun {
	return {
		transcript,
		finalOutput: transcript.at(-1)?.response ?? "",
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalLatencyMs: 0,
		totalToolCalls: 0,
		errors: 0,
		steps: transcript.length,
	};
}

describe("buildGradingPrompt", () => {
	it("keeps the end of a long final response", () => {
		const finalAnswer = `${"x".repeat(3_400)} Check that RENDER_API_KEY is set.`;
		const prompt = buildGradingPrompt(
			evalCase,
			run([step(1, "Looking..."), step(2, finalAnswer)]),
			[],
		);

		expect(prompt).toContain("Check that RENDER_API_KEY is set.");
		expect(prompt).not.toContain("[truncated");
	});

	it("still caps long intermediate responses", () => {
		const intermediate = `${"y".repeat(3_400)} INTERMEDIATE_TAIL`;
		const prompt = buildGradingPrompt(evalCase, run([step(1, intermediate), step(2, "Done.")]), []);

		expect(prompt).not.toContain("INTERMEDIATE_TAIL");
		expect(prompt).toContain("[truncated 418 chars]");
	});

	it("treats the last response of each user turn as final", () => {
		const turnOneAnswer = `${"z".repeat(3_400)} TURN_ONE_TAIL`;
		const prompt = buildGradingPrompt(
			evalCase,
			run([step(1, turnOneAnswer, 0), step(2, "Second answer.", 1)]),
			[],
		);

		expect(prompt).toContain("TURN_ONE_TAIL");
	});

	it("caps a final response past the larger limit", () => {
		const huge = `${"w".repeat(30_500)} HUGE_TAIL`;
		const prompt = buildGradingPrompt(evalCase, run([step(1, huge)]), []);

		expect(prompt).not.toContain("HUGE_TAIL");
		expect(prompt).toContain("[truncated 510 chars]");
	});
});
