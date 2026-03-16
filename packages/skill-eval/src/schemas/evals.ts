import { z } from "zod";

export const EvalCaseSchema = z
	.object({
		id: z.number(),
		prompt: z.string().optional(),
		turns: z.array(z.string()).min(1).optional(),
		expected_output: z.string(),
		files: z.array(z.string()).default([]),
		assertions: z.array(z.string()).min(1),
	})
	.refine((v) => v.prompt || v.turns, {
		message: "Either 'prompt' or 'turns' must be provided",
	})
	.refine((v) => !(v.prompt && v.turns), {
		message: "'prompt' and 'turns' are mutually exclusive — use one or the other",
	});

export const EvalsFileSchema = z.object({
	skill_name: z.string(),
	models: z.array(z.string()).optional(),
	evals: z.array(EvalCaseSchema).min(1),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalsFile = z.infer<typeof EvalsFileSchema>;

/** Normalize to a turns array regardless of whether prompt or turns was used. */
export function getTurns(evalCase: EvalCase): string[] {
	if (evalCase.turns) return evalCase.turns;
	if (evalCase.prompt) return [evalCase.prompt];
	return [];
}
