import OpenAI from "openai";
import { BaseProvider, buildChatResponse, normalizeChatParams } from "./base.js";
import { zodToJsonSchema } from "./schema.js";
import type { ChatParams, ChatResponse, ToolCall, ToolDefinition } from "./types.js";

function formatTools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: zodToJsonSchema(t.parameters),
		},
	}));
}

const STOP_MAP: Record<string, ChatResponse["stopReason"]> = {
	stop: "end",
	tool_calls: "tool_use",
	length: "max_tokens",
};

export class OpenAIProvider extends BaseProvider {
	readonly name = "openai";
	private readonly client: OpenAI;

	constructor(apiKey: string, model: string) {
		super(model);
		this.client = new OpenAI({ apiKey });
	}

	async chat(params: ChatParams): Promise<ChatResponse> {
		const start = Date.now();
		const { maxTokens, temperature } = normalizeChatParams(params);

		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: "system", content: params.system },
		];

		for (const m of params.messages) {
			if (m.role === "tool_result") {
				messages.push({
					role: "tool",
					tool_call_id: m.toolCallId ?? "",
					content: m.content,
				});
			} else if (m.role === "assistant" && m.toolCalls?.length) {
				messages.push({
					role: "assistant",
					content: m.content || null,
					tool_calls: m.toolCalls.map((tc) => ({
						id: tc.id,
						type: "function" as const,
						function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
					})),
				});
			} else {
				messages.push({
					role: m.role as "user" | "assistant",
					content: m.content,
				});
			}
		}

		const response = await this.client.chat.completions.create({
			model: this.modelId,
			messages,
			tools: params.tools?.length ? formatTools(params.tools) : undefined,
			temperature,
			max_completion_tokens: maxTokens,
		});

		const choice = response.choices[0];
		const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
			.filter((tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function")
			.map((tc) => ({
				id: tc.id,
				name: tc.function.name,
				arguments: JSON.parse(tc.function.arguments),
			}));

		return buildChatResponse({
			content: choice.message.content ?? "",
			toolCalls,
			inputTokens: response.usage?.prompt_tokens ?? 0,
			outputTokens: response.usage?.completion_tokens ?? 0,
			stopReason: STOP_MAP[choice.finish_reason ?? "stop"] ?? "end",
			latencyMs: Date.now() - start,
		});
	}
}
