import { z } from "zod";
import { ExpectationResultSchema } from "./grading.js";

const ProviderInfoSchema = z.object({
	name: z.string(),
	model: z.string(),
});

const StatsSchema = z.object({
	mean: z.number(),
	stddev: z.number(),
});

const RunResultSchema = z.object({
	pass_rate: z.number(),
	passed: z.number().int(),
	failed: z.number().int(),
	total: z.number().int(),
	time_seconds: z.number(),
	input_tokens: z.number().int(),
	output_tokens: z.number().int(),
	total_tokens: z.number().int(),
	tool_calls: z.number().int(),
	errors: z.number().int(),
	cost_usd: z.number(),
});

const BenchmarkRunSchema = z.object({
	eval_id: z.number(),
	provider: z.string(),
	model: z.string(),
	run_number: z.number().int(),
	result: RunResultSchema,
	expectations: z.array(ExpectationResultSchema),
	claims: z.array(z.string()).default([]),
	eval_feedback: z.string().nullable().default(null),
	error: z.string().nullable().default(null),
});

const ProviderSummarySchema = z.record(
	z.string(),
	z.object({
		pass_rate: StatsSchema,
		time_seconds: StatsSchema,
		total_tokens: StatsSchema,
		cost_usd: StatsSchema,
	}),
);

export const BenchmarkFileSchema = z.object({
	metadata: z.object({
		skill_name: z.string(),
		skill_path: z.string(),
		skill_version: z.string().optional(),
		skill_sha256: z.string().optional(),
		timestamp: z.string(),
		evals_run: z.array(z.number()),
		runs_per_provider: z.number().int(),
		providers: z.array(ProviderInfoSchema),
		grader: ProviderInfoSchema,
	}),
	runs: z.array(BenchmarkRunSchema),
	provider_summary: ProviderSummarySchema,
	notes: z.array(z.string()).default([]),
});

export type RunResult = z.infer<typeof RunResultSchema>;
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;
export type BenchmarkFile = z.infer<typeof BenchmarkFileSchema>;
export type ProviderSummary = z.infer<typeof ProviderSummarySchema>;
