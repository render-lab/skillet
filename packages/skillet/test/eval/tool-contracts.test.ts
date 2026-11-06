import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { stream, generateContent } = vi.hoisted(() => ({
	stream: vi.fn(),
	generateContent: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => ({
	default: class {
		messages = { stream };
	},
}));
vi.mock("@google/genai", () => ({
	GoogleGenAI: class {
		models = { generateContent };
	},
}));

import { AnthropicProvider } from "../../src/eval/providers/anthropic.js";
import { GoogleProvider } from "../../src/eval/providers/google.js";
import { OpenAIProvider } from "../../src/eval/providers/openai.js";
import { zodToJsonSchema } from "../../src/eval/providers/schema.js";
import { createMockEnvironment } from "../../src/eval/runner/mocks.js";

const parameters = {
	type: "object",
	properties: {
		blueprintId: { type: "string", description: "Blueprint ID" },
		manualEnvVars: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					serviceType: { type: "string", enum: ["web", "worker"] },
					serviceName: { type: "string" },
					key: { type: "string" },
					value: { type: "string", description: "Exact value, including empty strings" },
				},
				required: ["serviceType", "serviceName", "key", "value"],
			},
		},
	},
	required: ["blueprintId"],
	additionalProperties: false,
};

describe("mock tool contracts", () => {
	afterEach(() => vi.clearAllMocks());

	it("preserves imported nested JSON Schema through all provider request builders", async () => {
		const env = await createMockEnvironment(
			{
				blueprint: {
					expose: ["tools"],
					tools: [{ name: "approve_blueprint", description: "Approve", parameters }],
				},
			},
			{ blueprint: { state: {}, overrides: {} } },
		);
		try {
			const params = { system: "test", messages: [], tools: env.tools };
			stream.mockReturnValue({
				finalMessage: async () => ({
					content: [],
					usage: { input_tokens: 1, output_tokens: 1 },
					stop_reason: "end_turn",
				}),
			});
			await new AnthropicProvider("synthetic", "test").chat(params);
			expect(stream.mock.calls[0]?.[0].tools[0].input_schema).toEqual(parameters);
			generateContent.mockResolvedValue({ candidates: [] });
			await new GoogleProvider("synthetic", "test").chat(params);
			expect(
				generateContent.mock.calls[0]?.[0].config.tools[0].functionDeclarations[0]
					.parametersJsonSchema,
			).toEqual(parameters);
			const create = vi.fn().mockResolvedValue({ status: "completed", output: [] });
			await new OpenAIProvider("synthetic", "test", {
				responses: { create },
			} as unknown as OpenAI).chat(params);
			expect(create.mock.calls[0]?.[0].tools[0].parameters).toEqual(parameters);
		} finally {
			await env.cleanup();
		}
	});

	it("keeps built-in Zod tools compatible", () => {
		expect(
			zodToJsonSchema(z.object({ command: z.string(), retries: z.number().optional() })),
		).toEqual({
			type: "object",
			properties: { command: { type: "string" }, retries: { type: "number" } },
			required: ["command"],
		});
	});

	it("imports nested README parameters without promoting children to top-level fields", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "skillet-nested-readme-"));
		await writeFile(
			path.join(dir, "README.md"),
			[
				"- **approve_blueprint** - Approve after review",
				"  - `blueprintId`: Blueprint ID (string, required)",
				"  - `manualEnvVars`: Values (array of objects, optional when no values are required). Each object requires these fields:",
				"    - `serviceType`: Resource type (string). Accepted values: `web`, `worker`.",
				"    - `serviceName`: Resource name (string)",
				"    - `key`: Variable key (string)",
				"    - `value`: Exact value (string)",
				"  - `workspaceId`: Workspace (string, optional)",
				"- **list_services** - List resources",
				"  - `workspaceId`: Workspace (string, required)",
			].join("\n"),
		);
		try {
			const env = await createMockEnvironment(
				{ render: { mcpServer: dir, expose: ["tools"], tools: [] } },
				{ render: { state: {}, overrides: {} } },
			);
			try {
				const [approve, list] = env.tools;
				if (!approve || !list) throw new Error("Expected both imported tools");
				const schema = zodToJsonSchema(approve.parameters);
				expect(schema).toMatchObject({
					type: "object",
					required: ["blueprintId"],
					properties: {
						manualEnvVars: {
							type: "array",
							items: {
								type: "object",
								required: ["serviceType", "serviceName", "key", "value"],
								properties: {
									serviceType: { type: "string", enum: ["web", "worker"] },
									value: { type: "string" },
								},
							},
						},
						workspaceId: { type: "string" },
					},
				});
				expect(Object.keys(schema.properties as object)).toEqual([
					"blueprintId",
					"manualEnvVars",
					"workspaceId",
				]);
				expect(zodToJsonSchema(list.parameters)).toMatchObject({
					required: ["workspaceId"],
				});
			} finally {
				await env.cleanup();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
