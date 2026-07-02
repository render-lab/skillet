import { GoogleGenAI, Type } from "@google/genai";
import { BaseProvider, buildChatResponse, normalizeChatParams } from "./base.js";
import { zodToJsonSchema } from "./schema.js";
import type { ChatParams, ChatResponse, ToolCall, ToolDefinition } from "./types.js";

const JSON_TO_GOOGLE_TYPE: Record<string, string> = {
	object: Type.OBJECT,
	string: Type.STRING,
	number: Type.NUMBER,
	boolean: Type.BOOLEAN,
};

function toGoogleSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
	const result = { ...jsonSchema };
	if (typeof result.type === "string" && JSON_TO_GOOGLE_TYPE[result.type]) {
		result.type = JSON_TO_GOOGLE_TYPE[result.type];
	}
	if (result.properties && typeof result.properties === "object") {
		const mapped: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(result.properties as Record<string, unknown>)) {
			mapped[k] = toGoogleSchema(v as Record<string, unknown>);
		}
		result.properties = mapped;
	}
	return result;
}

function formatTools(tools: ToolDefinition[]) {
	return [
		{
			functionDeclarations: tools.map((t) => ({
				name: t.name,
				description: t.description,
				parameters: toGoogleSchema(zodToJsonSchema(t.parameters)),
			})),
		},
	];
}

function extractTextParts(parts: Array<Record<string, unknown>> | undefined): string {
	return (
		parts
			?.map((part) => (typeof part.text === "string" ? part.text : ""))
			.filter(Boolean)
			.join("") ?? ""
	);
}

export class GoogleProvider extends BaseProvider {
	readonly name = "google";
	private readonly ai: GoogleGenAI;

	constructor(apiKey: string, model: string) {
		super(model);
		this.ai = new GoogleGenAI({ apiKey });
	}

	async chat(params: ChatParams): Promise<ChatResponse> {
		const start = Date.now();
		const { maxTokens, temperature } = normalizeChatParams(params);

		const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
		for (const m of params.messages) {
			if (m.role === "tool_result") {
				contents.push({
					role: "user",
					parts: [
						{
							functionResponse: {
								name: m.toolCallId,
								response: { result: m.content },
							},
						},
					],
				});
			} else if (m.role === "assistant" && m.toolCalls?.length) {
				if (m._rawParts) {
					contents.push({ role: "model", parts: m._rawParts as Array<Record<string, unknown>> });
				} else {
					const parts: Array<Record<string, unknown>> = [];
					if (m.content) parts.push({ text: m.content });
					for (const tc of m.toolCalls) {
						parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
					}
					contents.push({ role: "model", parts });
				}
			} else {
				contents.push({
					role: m.role === "assistant" ? "model" : "user",
					parts: [{ text: m.content }],
				});
			}
		}

		const config = {
			systemInstruction: params.system,
			tools: params.tools?.length ? formatTools(params.tools) : undefined,
			maxOutputTokens: maxTokens,
			...(temperature !== undefined ? { temperature } : {}),
		};

		const response = await this.ai.models.generateContent({
			model: this.modelId,
			contents,
			config,
		});

		const rawParts = response.candidates?.[0]?.content?.parts as
			| Array<Record<string, unknown>>
			| undefined;
		const text = extractTextParts(rawParts);
		const toolCalls: ToolCall[] = (response.functionCalls ?? []).map((fc, i) => ({
			id: `${fc.name}_${i}`,
			name: fc.name ?? "",
			arguments: (fc.args as Record<string, unknown>) ?? {},
		}));

		const hasToolCalls = toolCalls.length > 0;
		const usage = response.usageMetadata;

		let stopReason: ChatResponse["stopReason"] = "end";
		if (hasToolCalls) stopReason = "tool_use";
		else if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") stopReason = "max_tokens";

		const result = buildChatResponse({
			content: text,
			toolCalls,
			inputTokens: usage?.promptTokenCount ?? 0,
			outputTokens: usage?.candidatesTokenCount ?? 0,
			stopReason,
			latencyMs: Date.now() - start,
		});

		if (rawParts) {
			result._rawParts = rawParts;
		}

		return result;
	}
}
