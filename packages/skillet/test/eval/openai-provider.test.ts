import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAIProvider } from "../../src/eval/providers/openai.js";
import type { Message } from "../../src/eval/providers/types.js";

type CreateParams = OpenAI.Responses.ResponseCreateParamsNonStreaming;

function mockClient(...responses: Array<Partial<OpenAI.Responses.Response>>) {
	const create = vi.fn();
	for (const r of responses) create.mockResolvedValueOnce(r);
	const client = { responses: { create } } as unknown as OpenAI;
	return { client, create };
}

function lastRequest(create: ReturnType<typeof vi.fn>): CreateParams {
	return create.mock.calls.at(-1)?.[0] as CreateParams;
}

const reasoningItem = {
	type: "reasoning",
	id: "rs_1",
	summary: [],
} as const;

const functionCallItem = {
	type: "function_call",
	id: "fc_1",
	call_id: "call_1",
	name: "bash",
	arguments: '{"command":"ls"}',
	status: "completed",
} as const;

const messageItem = {
	type: "message",
	id: "msg_1",
	role: "assistant",
	status: "completed",
	content: [{ type: "output_text", text: "Listing files.", annotations: [] }],
} as const;

const tools = [
	{
		name: "bash",
		description: "Run a command",
		parameters: z.object({ command: z.string(), cwd: z.string().optional() }),
	},
];

describe("OpenAIProvider (Responses API)", () => {
	it("maps system, messages, tools, and limits onto a responses.create request", async () => {
		const { client, create } = mockClient({
			status: "completed",
			output: [],
			usage: { input_tokens: 1, output_tokens: 1 } as OpenAI.Responses.ResponseUsage,
		});
		const provider = new OpenAIProvider("key", "gpt-6-astra", client);

		await provider.chat({
			system: "be helpful",
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
				{ role: "user", content: "list files" },
			],
			tools,
			maxTokens: 1000,
		});

		const req = lastRequest(create);
		expect(req.model).toBe("gpt-6-astra");
		expect(req.instructions).toBe("be helpful");
		expect(req.max_output_tokens).toBe(1000);
		expect(req.input).toEqual([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
			{ role: "user", content: "list files" },
		]);
		expect(req.tools).toEqual([
			{
				type: "function",
				name: "bash",
				description: "Run a command",
				parameters: {
					type: "object",
					properties: { command: { type: "string" }, cwd: { type: "string" } },
					required: ["command"],
				},
				strict: false,
			},
		]);
		expect(req).not.toHaveProperty("temperature");
		expect(req).not.toHaveProperty("reasoning");
		expect(req).not.toHaveProperty("messages");
	});

	it("only sends temperature when configured and omits tools when none are given", async () => {
		const { client, create } = mockClient({ status: "completed", output: [] });
		const provider = new OpenAIProvider("key", "gpt-4o", client);

		await provider.chat({
			system: "s",
			messages: [{ role: "user", content: "hi" }],
			temperature: 0.2,
		});

		const req = lastRequest(create);
		expect(req.temperature).toBe(0.2);
		expect(req).not.toHaveProperty("tools");
	});

	it("parses function calls, text, usage, and keeps raw output items", async () => {
		const output = [reasoningItem, messageItem, functionCallItem];
		const { client } = mockClient({
			status: "completed",
			output: output as unknown as OpenAI.Responses.ResponseOutputItem[],
			usage: { input_tokens: 42, output_tokens: 7 } as OpenAI.Responses.ResponseUsage,
		});
		const provider = new OpenAIProvider("key", "gpt-6-astra", client);

		const res = await provider.chat({
			system: "s",
			messages: [{ role: "user", content: "list files" }],
			tools,
		});

		expect(res.content).toBe("Listing files.");
		expect(res.toolCalls).toEqual([{ id: "call_1", name: "bash", arguments: { command: "ls" } }]);
		expect(res.stopReason).toBe("tool_use");
		expect(res.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
		expect(res._rawParts).toEqual(output);
	});

	it("reports end and max_tokens stop reasons", async () => {
		const { client } = mockClient(
			{
				status: "completed",
				output: [messageItem] as unknown as OpenAI.Responses.ResponseOutputItem[],
			},
			{
				status: "incomplete",
				incomplete_details: { reason: "max_output_tokens" },
				output: [reasoningItem] as unknown as OpenAI.Responses.ResponseOutputItem[],
			},
		);
		const provider = new OpenAIProvider("key", "gpt-6-astra", client);
		const params = { system: "s", messages: [{ role: "user" as const, content: "hi" }] };

		const done = await provider.chat(params);
		expect(done.stopReason).toBe("end");
		expect(done.toolCalls).toBeUndefined();

		const truncated = await provider.chat(params);
		expect(truncated.stopReason).toBe("max_tokens");
		expect(truncated.content).toBe("");
	});

	it("round-trips tool calls and results, replaying reasoning items", async () => {
		const { client, create } = mockClient(
			{
				status: "completed",
				output: [
					reasoningItem,
					functionCallItem,
				] as unknown as OpenAI.Responses.ResponseOutputItem[],
			},
			{
				status: "completed",
				output: [messageItem] as unknown as OpenAI.Responses.ResponseOutputItem[],
			},
		);
		const provider = new OpenAIProvider("key", "gpt-6-astra", client);

		const messages: Message[] = [{ role: "user", content: "list files" }];
		const first = await provider.chat({ system: "s", messages, tools });
		messages.push({
			role: "assistant",
			content: first.content,
			toolCalls: first.toolCalls,
			_rawParts: first._rawParts,
		});
		for (const tc of first.toolCalls ?? []) {
			messages.push({ role: "tool_result", content: '{"stdout":"a.txt"}', toolCallId: tc.id });
		}

		await provider.chat({ system: "s", messages, tools });

		expect(lastRequest(create).input).toEqual([
			{ role: "user", content: "list files" },
			reasoningItem,
			functionCallItem,
			{ type: "function_call_output", call_id: "call_1", output: '{"stdout":"a.txt"}' },
		]);
	});

	it("applies compacted text and arguments when replaying raw items", async () => {
		const { client, create } = mockClient({ status: "completed", output: [] });
		const provider = new OpenAIProvider("key", "gpt-6-astra", client);

		await provider.chat({
			system: "s",
			messages: [
				{ role: "user", content: "go" },
				{
					role: "assistant",
					content: "[truncated]",
					toolCalls: [{ id: "call_1", name: "bash", arguments: { command: "[truncated]" } }],
					_rawParts: [reasoningItem, messageItem, functionCallItem],
				},
				{ role: "tool_result", content: "ok", toolCallId: "call_1" },
			],
		});

		expect(lastRequest(create).input).toEqual([
			{ role: "user", content: "go" },
			reasoningItem,
			{
				...messageItem,
				content: [{ type: "output_text", text: "[truncated]", annotations: [] }],
			},
			{ ...functionCallItem, arguments: '{"command":"[truncated]"}' },
			{ type: "function_call_output", call_id: "call_1", output: "ok" },
		]);
	});

	it("builds function_call items when no raw items are available", async () => {
		const { client, create } = mockClient({ status: "completed", output: [] });
		const provider = new OpenAIProvider("key", "gpt-5.4", client);

		await provider.chat({
			system: "s",
			messages: [
				{ role: "user", content: "go" },
				{
					role: "assistant",
					content: "running",
					toolCalls: [{ id: "call_9", name: "read_file", arguments: { path: "a.txt" } }],
				},
				{ role: "tool_result", content: "contents", toolCallId: "call_9" },
			],
		});

		expect(lastRequest(create).input).toEqual([
			{ role: "user", content: "go" },
			{ role: "assistant", content: "running" },
			{
				type: "function_call",
				call_id: "call_9",
				name: "read_file",
				arguments: '{"path":"a.txt"}',
			},
			{ type: "function_call_output", call_id: "call_9", output: "contents" },
		]);
	});
});
