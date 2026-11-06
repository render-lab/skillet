import { z } from "zod";

const ToolResultSchema = z.object({
	id: z.string(),
	name: z.string(),
	result: z.unknown(),
});

export const TranscriptStepSchema = z.object({
	step: z.number().int(),
	turn: z.number().int().optional(),
	userMessage: z.string().optional(),
	turnSkipped: z.string().optional(),
	response: z.string(),
	providerStopReason: z.string().optional(),
	toolCalls: z
		.array(
			z.object({
				id: z.string(),
				name: z.string(),
				arguments: z.record(z.unknown()),
			}),
		)
		.optional(),
	toolResults: z.array(ToolResultSchema),
	usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
	latencyMs: z.number(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;
export type TranscriptStep = z.infer<typeof TranscriptStepSchema>;
