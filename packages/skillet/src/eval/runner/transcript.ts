import type { TranscriptStep } from "../schemas/transcript.js";
export type { TranscriptStep, ToolResult } from "../schemas/transcript.js";

export interface AgentRun {
	transcript: TranscriptStep[];
	finalOutput: string;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalLatencyMs: number;
	totalToolCalls: number;
	errors: number;
	steps: number;
}

export function buildAgentRun(transcript: TranscriptStep[]): AgentRun {
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalLatencyMs = 0;
	let totalToolCalls = 0;
	let errors = 0;

	for (const step of transcript) {
		totalInputTokens += step.usage.inputTokens;
		totalOutputTokens += step.usage.outputTokens;
		totalLatencyMs += step.latencyMs;
		totalToolCalls += step.toolCalls?.length ?? 0;
		for (const tr of step.toolResults) {
			const r = tr.result as Record<string, unknown>;
			if (r?.error) errors++;
		}
	}

	const lastStep = transcript[transcript.length - 1];
	return {
		transcript,
		finalOutput: lastStep?.response ?? "",
		totalInputTokens,
		totalOutputTokens,
		totalLatencyMs,
		totalToolCalls,
		errors,
		steps: transcript.length,
	};
}
