import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { chatMock, multiselectMock, textMock, selectMock } = vi.hoisted(() => ({
	chatMock: vi.fn(),
	multiselectMock: vi.fn(),
	textMock: vi.fn(),
	selectMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn(() => false),
	multiselect: multiselectMock,
	text: textMock,
	select: selectMock,
	log: {
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("../../src/eval/providers/factory.js", () => ({
	createProvider: vi.fn(() => ({
		modelId: "gpt-5.4",
		chat: chatMock,
	})),
}));

import { runGenerate } from "../../src/eval/commands/generate.js";

describe("runGenerate", () => {
	let tmpDir: string;
	let originalCwd: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-generate-"));
		originalCwd = process.cwd();
		originalEnv = { ...process.env };
		process.chdir(tmpDir);
		process.env.OPENAI_API_KEY = "openai-key";
		await writeFile(path.join(tmpDir, "package.json"), '{ "name": "test-project" }\n');
		await writeFile(path.join(tmpDir, "SKILL.md"), "# skill\n");
		await writeFile(path.join(tmpDir, "evals.json"), '{ "existing": true }\n');

		chatMock.mockReset();
		multiselectMock.mockResolvedValue(["gpt-5.4"]);
		textMock.mockResolvedValue("1");
		selectMock.mockResolvedValue("skip");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		process.chdir(originalCwd);
		for (const key of Object.keys(process.env)) {
			delete process.env[key];
		}
		Object.assign(process.env, originalEnv);
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("skips generation entirely when evals.json already exists and skip is selected", async () => {
		await runGenerate({ skills: [tmpDir], count: "1" });

		expect(chatMock).not.toHaveBeenCalled();
		expect(await readFile(path.join(tmpDir, "evals.json"), "utf-8")).toBe('{ "existing": true }\n');
	});

	it("includes configured integration mock resources in the generation prompt", async () => {
		const configPath = path.join(tmpDir, "skillet.eval.yaml");
		const openapiPath = path.join(tmpDir, "fixtures/openapi.json");
		const mcpToolsDir = path.join(tmpDir, "fixtures/mcp/tools");
		await mkdir(path.dirname(openapiPath), { recursive: true });
		await mkdir(mcpToolsDir, { recursive: true });
		await writeFile(
			openapiPath,
			JSON.stringify({
				openapi: "3.1.0",
				paths: {
					"/services/{id}": {
						get: {
							operationId: "getService",
							responses: { "200": { description: "ok" } },
						},
					},
				},
			}),
		);
		await writeFile(
			path.join(mcpToolsDir, "list_services.json"),
			JSON.stringify({
				name: "list_services",
				description: "List services in the account",
				arguments: { type: "object", properties: {} },
			}),
		);
		await writeFile(
			configPath,
			[
				"providers:",
				"  - name: openai",
				"    model: gpt-5.4",
				"    apiKey: ${OPENAI_API_KEY}",
				"integrations:",
				"  render:",
				"    openapi: ./fixtures/openapi.json",
				"    mcpServer: ./fixtures/mcp",
				"    expose: [http, tools]",
				"",
			].join("\n"),
		);
		selectMock.mockResolvedValue("generated");
		chatMock.mockResolvedValue({
			content: JSON.stringify({
				skill_name: "skill",
				models: ["gpt-5.4"],
				evals: [
					{
						id: 1,
						prompt: "Debug the unhealthy service.",
						expected_output: "The service is identified.",
						integrations: {
							render: {
								state: { services: [{ id: "svc_123", status: "unhealthy" }] },
								overrides: {
									"GET /services/{id}": { responseFromState: "services[id]" },
									"tool:list_services": { responseFromState: "services" },
								},
							},
						},
						assertions: ["The agent identifies the service"],
					},
				],
			}),
			usage: { inputTokens: 1, outputTokens: 1 },
			stopReason: "end",
			latencyMs: 1,
		});

		await runGenerate({ skills: [tmpDir], count: "1", config: configPath });

		const prompt = chatMock.mock.calls[0]?.[0].messages[0]?.content;
		expect(prompt).toContain("Available Integration Mock Resources");
		expect(prompt).toContain("### render");
		expect(prompt).toContain("GET /services/{id}");
		expect(prompt).toContain("tool:list_services");
		expect(await readFile(path.join(tmpDir, "evals.generated.json"), "utf-8")).toContain(
			'"integrations"',
		);
	});
});
