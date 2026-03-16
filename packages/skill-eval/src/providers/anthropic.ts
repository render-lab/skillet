import Anthropic from "@anthropic-ai/sdk";
import { BaseProvider, buildChatResponse, normalizeChatParams } from "./base.js";
import { zodToJsonSchema } from "./schema.js";
import type { ChatParams, ChatResponse, ToolCall, ToolDefinition } from "./types.js";

function formatTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: zodToJsonSchema(t.parameters) as Anthropic.Messages.Tool.InputSchema,
	}));
}

const STOP_MAP: Record<string, ChatResponse["stopReason"]> = {
	end_turn: "end",
	tool_use: "tool_use",
	max_tokens: "max_tokens",
};

export class AnthropicProvider extends BaseProvider {
	readonly name = "anthropic";
	private readonly client: Anthropic;

	constructor(apiKey: string, model: string) {
		super(model);
		this.client = new Anthropic({ apiKey });
	}

	async chat(params: ChatParams): Promise<ChatResponse> {
		const start = Date.now();
		const { maxTokens, temperature } = normalizeChatParams(params);

		const messages: Anthropic.Messages.MessageParam[] = params.messages.map((m) => {
			if (m.role === "tool_result") {
				return {
					role: "user" as const,
					content: [
						{
							type: "tool_result" as const,
							tool_use_id: m.toolCallId ?? "",
							content: m.content,
						},
					],
				};
			}
			if (m.role === "assistant" && m.toolCalls?.length) {
				const blocks: Anthropic.Messages.ContentBlockParam[] = [];
				if (m.content) blocks.push({ type: "text", text: m.content });
				for (const tc of m.toolCalls) {
					blocks.push({
						type: "tool_use",
						id: tc.id,
						name: tc.name,
						input: tc.arguments,
					});
				}
				return { role: "assistant" as const, content: blocks };
			}
			return { role: m.role as "user" | "assistant", content: m.content };
		});

		const stream = this.client.messages.stream({
			model: this.modelId,
			max_tokens: maxTokens,
			system: params.system,
			messages,
			tools: params.tools?.length ? formatTools(params.tools) : undefined,
			temperature,
		});

		const response = await stream.finalMessage();

		let content = "";
		const toolCalls: ToolCall[] = [];
		for (const block of response.content) {
			if (block.type === "text") content += block.text;
			if (block.type === "tool_use") {
				toolCalls.push({
					id: block.id,
					name: block.name,
					arguments: block.input as Record<string, unknown>,
				});
			}
		}

		return buildChatResponse({
			content,
			toolCalls,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
			stopReason: STOP_MAP[response.stop_reason ?? "end_turn"] ?? "end",
			latencyMs: Date.now() - start,
		});
	}
}
