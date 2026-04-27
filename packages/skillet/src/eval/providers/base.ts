import type { ChatParams, ChatResponse, LLMProvider, ToolCall } from "./types.js";

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0;

/** Normalize optional ChatParams fields to concrete defaults. */
export function normalizeChatParams(params: ChatParams): {
	maxTokens: number;
	temperature: number;
} {
	return {
		maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
		temperature: params.temperature ?? DEFAULT_TEMPERATURE,
	};
}

/** Assemble a standardized ChatResponse from provider-specific parts. */
export function buildChatResponse(opts: {
	content: string;
	toolCalls: ToolCall[];
	inputTokens: number;
	outputTokens: number;
	stopReason: ChatResponse["stopReason"];
	latencyMs: number;
}): ChatResponse {
	return {
		content: opts.content,
		toolCalls: opts.toolCalls.length ? opts.toolCalls : undefined,
		usage: { inputTokens: opts.inputTokens, outputTokens: opts.outputTokens },
		stopReason: opts.stopReason,
		latencyMs: opts.latencyMs,
	};
}

/** Base class that holds common provider wiring. */
export abstract class BaseProvider implements LLMProvider {
	abstract readonly name: string;
	readonly modelId: string;

	constructor(model: string) {
		this.modelId = model;
	}

	abstract chat(params: ChatParams): Promise<ChatResponse>;
}
