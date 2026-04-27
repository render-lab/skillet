import { z } from "zod";

export const ExpectationResultSchema = z.object({
	text: z.string(),
	passed: z.boolean(),
	evidence: z.string(),
});

export const GradingResultSchema = z.object({
	pass_rate: z.number().min(0).max(1),
	passed: z.number().int().min(0),
	failed: z.number().int().min(0),
	total: z.number().int().min(1),
	expectations: z.array(ExpectationResultSchema),
	claims: z.array(z.string()).default([]),
	eval_feedback: z.string().nullable().default(null),
});

export type ExpectationResult = z.infer<typeof ExpectationResultSchema>;
export type GradingResult = z.infer<typeof GradingResultSchema>;
