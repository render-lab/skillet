import type { LLMProvider } from "../providers/types.js";
import type { AgentRun } from "../runner/transcript.js";
import type { EvalCase } from "../schemas/evals.js";
import { type GradingResult, GradingResultSchema } from "../schemas/grading.js";
import { extractJson } from "../utils/json.js";
import { GRADER_SYSTEM_PROMPT, buildGradingPrompt } from "./prompts.js";

export async function gradeRun(
	graderProvider: LLMProvider,
	evalCase: EvalCase,
	agentRun: AgentRun,
	outputFiles: Array<{ path: string; content: string }>,
): Promise<GradingResult> {
	const prompt = buildGradingPrompt(evalCase, agentRun, outputFiles);

	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await graderProvider.chat({
			system: GRADER_SYSTEM_PROMPT,
			messages: [{ role: "user", content: prompt }],
		});

		try {
			const raw = JSON.parse(extractJson(response.content));

			const expectations = raw.expectations ?? [];
			const passed = expectations.filter((e: { passed?: boolean }) => e.passed === true).length;
			const failed = expectations.length - passed;

			const result = GradingResultSchema.parse({
				pass_rate: expectations.length > 0 ? passed / expectations.length : 0,
				passed,
				failed,
				total: expectations.length,
				expectations,
				claims: raw.claims ?? [],
				eval_feedback: raw.eval_feedback ?? null,
			});

			return result;
		} catch {
			if (attempt === 1) {
				return {
					pass_rate: 0,
					passed: 0,
					failed: evalCase.assertions.length,
					total: evalCase.assertions.length,
					expectations: evalCase.assertions.map((a) => ({
						text: a,
						passed: false,
						evidence: "Grader failed to produce valid JSON after 2 attempts",
					})),
					claims: [],
					eval_feedback: `Grader error: could not parse response. Raw output: ${response.content.slice(0, 500)}`,
				};
			}
		}
	}

	throw new Error("Unreachable");
}
