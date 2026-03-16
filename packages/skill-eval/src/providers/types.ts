import type { z } from "zod";

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: z.ZodType;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface Message {
	role: "user" | "assistant" | "tool_result";
	content: string;
	toolCalls?: ToolCall[];
	toolCallId?: string;
	/** Opaque provider-specific parts for faithful multi-turn replay (e.g. Gemini thought signatures). */
	_rawParts?: unknown;
}

export interface ChatResponse {
	content: string;
	toolCalls?: ToolCall[];
	usage: { inputTokens: number; outputTokens: number };
	stopReason: "end" | "tool_use" | "max_tokens";
	latencyMs: number;
	/** Opaque provider-specific parts for faithful multi-turn replay (e.g. Gemini thought signatures). */
	_rawParts?: unknown;
}

export interface ChatParams {
	system: string;
	messages: Message[];
	tools?: ToolDefinition[];
	temperature?: number;
	maxTokens?: number;
}

export interface LLMProvider {
	readonly name: string;
	readonly modelId: string;
	chat(params: ChatParams): Promise<ChatResponse>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
