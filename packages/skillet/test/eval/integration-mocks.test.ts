import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MockIntegrationConfig } from "../../src/eval/config/schema.js";
import { createIntegrationMockEnvironment } from "../../src/eval/runner/integration-mocks.js";
import type { EvalIntegrationScenario } from "../../src/eval/schemas/evals.js";

describe("createIntegrationMockEnvironment", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
		dirs.length = 0;
	});

	async function makeSources() {
		const dir = await mkdtemp(path.join(tmpdir(), "skillet-integration-mocks-"));
		dirs.push(dir);
		const openapiPath = path.join(dir, "openapi.json");
		const mcpDir = path.join(dir, "mcp", "tools");
		await mkdir(mcpDir, { recursive: true });
		await writeFile(
			openapiPath,
			JSON.stringify({
				openapi: "3.1.0",
				paths: {
					"/services": {
						get: {
							operationId: "listServices",
							responses: { "200": { description: "ok" } },
						},
					},
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
			path.join(mcpDir, "list_services.json"),
			JSON.stringify({
				name: "list_services",
				description: "List services",
				arguments: {
					type: "object",
					properties: {
						includePreviews: { type: "boolean" },
					},
				},
			}),
		);
		return { openapiPath, mcpDir: path.dirname(mcpDir) };
	}

	it("returns an inert environment when no scenarios reference integrations", async () => {
		const env = await createIntegrationMockEnvironment({}, {});

		expect(env.tools).toEqual([]);
		expect(env.handlers).toEqual({});
		expect(env.instructions).toEqual([]);
		expect(env.outputFiles()).toEqual([]);

		await env.cleanup();
	});

	it("serves OpenAPI-derived routes from scenario state", async () => {
		const { openapiPath } = await makeSources();
		const config: Record<string, MockIntegrationConfig> = {
			render: { openapi: openapiPath, expose: ["http"], tools: [] },
		};
		const scenario: Record<string, EvalIntegrationScenario> = {
			render: {
				state: {
					services: [{ id: "svc_123", name: "api", status: "unhealthy" }],
				},
				overrides: {},
			},
		};

		const env = await createIntegrationMockEnvironment(config, scenario);
		try {
			const baseUrl = env.instructions[0]?.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
			expect(baseUrl).toBeDefined();

			const response = await fetch(`${baseUrl}/services/svc_123`);
			await expect(response.json()).resolves.toEqual({
				id: "svc_123",
				name: "api",
				status: "unhealthy",
			});
		} finally {
			await env.cleanup();
		}
	});

	it("imports MCP descriptor tools and resolves responses from scenario state", async () => {
		const { mcpDir } = await makeSources();
		const config: Record<string, MockIntegrationConfig> = {
			render: { mcpServer: mcpDir, expose: ["tools"], tools: [] },
		};
		const scenario: Record<string, EvalIntegrationScenario> = {
			render: {
				state: {
					services: [{ id: "svc_123", name: "api" }],
				},
				overrides: {
					"tool:list_services": { responseFromState: "services" },
				},
			},
		};

		const env = await createIntegrationMockEnvironment(config, scenario);
		try {
			expect(env.tools.map((tool) => tool.name)).toContain("list_services");
			await expect(env.handlers.list_services?.({})).resolves.toEqual([
				{ id: "svc_123", name: "api" },
			]);
			expect(env.outputFiles()[0]?.content).toContain("svc_123");
		} finally {
			await env.cleanup();
		}
	});
});
