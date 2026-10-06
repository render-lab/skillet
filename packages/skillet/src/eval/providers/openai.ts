import OpenAI from "openai";
import { BaseProvider, buildChatResponse, normalizeChatParams } from "./base.js";
import { zodToJsonSchema } from "./schema.js";
import type { ChatParams, ChatResponse, Message, ToolCall, ToolDefinition } from "./types.js";

type InputItem = OpenAI.Responses.ResponseInputItem;
type OutputItem = OpenAI.Responses.ResponseOutputItem;

function formatTools(tools: ToolDefinition[]): OpenAI.Responses.FunctionTool[] {
	return tools.map((t) => ({
		type: "function" as const,
		name: t.name,
		description: t.description,
		parameters: zodToJsonSchema(t.parameters),
		// Responses defaults to strict mode, which requires every property to be
		// required and `additionalProperties: false`. Our schemas allow optional
		// fields, so keep the Chat Completions behavior.
		strict: false,
	}));
}

function extractText(output: OutputItem[]): string {
	return output
		.filter((item): item is OpenAI.Responses.ResponseOutputMessage => item.type === "message")
		.flatMap((item) => item.content)
		.map((part) => (part.type === "output_text" ? part.text : ""))
		.join("");
}

/**
 * Replay a previous assistant turn from its raw Responses output items so
 * reasoning items stay attached to the function calls they produced. Text and
 * tool-call arguments come from the message itself, since context compaction
 * may have truncated them.
 */
function replayAssistant(m: Message, rawItems: OutputItem[]): InputItem[] {
	const argsByCallId = new Map((m.toolCalls ?? []).map((tc) => [tc.id, tc.arguments]));
	const items: InputItem[] = [];
	let textEmitted = false;

	for (const item of rawItems) {
		if (item.type === "function_call") {
			const args = argsByCallId.get(item.call_id);
			items.push(args ? { ...item, arguments: JSON.stringify(args) } : item);
		} else if (item.type === "message") {
			if (textEmitted || !m.content) continue;
			items.push({
				...item,
				content: [{ type: "output_text", text: m.content, annotations: [] }],
			});
			textEmitted = true;
		} else {
			items.push(item as InputItem);
		}
	}

	return items;
}

function toInputItems(messages: Message[]): InputItem[] {
	const input: InputItem[] = [];

	for (const m of messages) {
		if (m.role === "tool_result") {
			input.push({
				type: "function_call_output",
				call_id: m.toolCallId ?? "",
				output: m.content,
			});
		} else if (m.role === "assistant" && m.toolCalls?.length) {
			if (Array.isArray(m._rawParts)) {
				input.push(...replayAssistant(m, m._rawParts as OutputItem[]));
				continue;
			}
			if (m.content) input.push({ role: "assistant", content: m.content });
			for (const tc of m.toolCalls) {
				input.push({
					type: "function_call",
					call_id: tc.id,
					name: tc.name,
					arguments: JSON.stringify(tc.arguments),
				});
			}
		} else {
			input.push({ role: m.role as "user" | "assistant", content: m.content });
		}
	}

	return input;
}

export class OpenAIProvider extends BaseProvider {
	readonly name = "openai";
	private readonly client: OpenAI;

	constructor(apiKey: string, model: string, client?: OpenAI) {
		super(model);
		this.client = client ?? new OpenAI({ apiKey });
	}

	async chat(params: ChatParams): Promise<ChatResponse> {
		const start = Date.now();
		const { maxTokens, temperature } = normalizeChatParams(params);

		const request: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
			model: this.modelId,
			instructions: params.system,
			input: toInputItems(params.messages),
			max_output_tokens: maxTokens,
		};
		if (params.tools?.length) request.tools = formatTools(params.tools);
		if (temperature !== undefined) request.temperature = temperature;

		const response = await this.client.responses.create(request);

		const output = response.output ?? [];
		const toolCalls: ToolCall[] = output
			.filter(
				(item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
			)
			.map((item) => ({
				id: item.call_id,
				name: item.name,
				arguments: item.arguments ? JSON.parse(item.arguments) : {},
			}));

		let stopReason: ChatResponse["stopReason"] = "end";
		if (toolCalls.length) stopReason = "tool_use";
		else if (
			response.status === "incomplete" &&
			response.incomplete_details?.reason === "max_output_tokens"
		)
			stopReason = "max_tokens";

		const result = buildChatResponse({
			content: extractText(output),
			toolCalls,
			inputTokens: response.usage?.input_tokens ?? 0,
			outputTokens: response.usage?.output_tokens ?? 0,
			stopReason,
			latencyMs: Date.now() - start,
		});

		// Keep raw output items (including reasoning) so the next request can
		// replay them alongside the function calls they belong to.
		if (output.length) result._rawParts = output;

		return result;
	}
}
