import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MockIntegrationConfig } from "../../src/eval/config/schema.js";
import {
	createIntegrationMockEnvironment,
	summarizeIntegrationMockSources,
	writeIntegrationMockManifests,
} from "../../src/eval/runner/integration-mocks.js";
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

	it("imports YAML OpenAPI specs", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "skillet-yaml-openapi-"));
		dirs.push(dir);
		const openapiPath = path.join(dir, "openapi.yaml");
		await writeFile(
			openapiPath,
			[
				"openapi: 3.0.0",
				"paths:",
				"  /services/{id}:",
				"    get:",
				"      responses:",
				"        '200':",
				"          description: ok",
				"",
			].join("\n"),
		);
		const manifests = await writeIntegrationMockManifests(
			{
				render: { openapi: openapiPath, expose: ["http"], tools: [] },
			},
			dir,
		);

		expect(manifests[0]?.httpRoutes).toEqual([
			expect.objectContaining({ key: "GET /services/{id}" }),
		]);
	});

	it("reports oapi-codegen configs as the wrong OpenAPI source", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "skillet-oapi-config-"));
		dirs.push(dir);
		const openapiPath = path.join(dir, "oapi-codegen.yaml");
		await writeFile(
			openapiPath,
			[
				"package: common",
				"output: ''",
				"import-mapping:",
				"  ./autoscaling.yaml: github.com/example/autoscaling",
				"",
			].join("\n"),
		);
		const manifests = await writeIntegrationMockManifests(
			{
				render: { openapi: openapiPath, expose: ["http"], tools: [] },
			},
			dir,
		);

		expect(manifests[0]?.errors[0]).toContain("looks like an oapi-codegen config");
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

	it("imports MCP tools from a README when descriptors are not available", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "skillet-readme-mcp-"));
		dirs.push(dir);
		await writeFile(
			path.join(dir, "README.md"),
			[
				"# Example MCP Server",
				"",
				"## Tools",
				"",
				"- **get_metrics** - Get performance metrics for a resource",
				" - `resourceId`: The ID of the resource to get metrics for (string, required)",
				" - `metricTypes`: Which metrics to fetch (array, required)",
				"",
			].join("\n"),
		);
		const config: Record<string, MockIntegrationConfig> = {
			render: { mcpServer: dir, expose: ["tools"], tools: [] },
		};

		const manifests = await writeIntegrationMockManifests(config, dir);

		expect(manifests[0]?.tools).toEqual([
			expect.objectContaining({
				key: "tool:get_metrics",
				name: "get_metrics",
				parameters: expect.objectContaining({
					required: ["resourceId", "metricTypes"],
				}),
			}),
		]);
	});

	it("writes materialized manifests and summarizes from them", async () => {
		const { openapiPath, mcpDir } = await makeSources();
		const manifestRoot = await mkdtemp(path.join(tmpdir(), "skillet-integration-manifests-"));
		dirs.push(manifestRoot);
		const config: Record<string, MockIntegrationConfig> = {
			render: { openapi: openapiPath, mcpServer: mcpDir, expose: ["http", "tools"], tools: [] },
		};

		const manifests = await writeIntegrationMockManifests(config, manifestRoot);
		const manifestPath = path.join(manifestRoot, "render", "manifest.json");

		expect(manifests[0]).toMatchObject({
			name: "render",
			httpRoutes: expect.arrayContaining([expect.objectContaining({ key: "GET /services/{id}" })]),
			tools: expect.arrayContaining([expect.objectContaining({ key: "tool:list_services" })]),
		});
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
		expect(manifest.sources).toMatchObject({
			openapi: [openapiPath],
			mcpServer: [mcpDir],
			expose: ["http", "tools"],
		});

		const summaries = await summarizeIntegrationMockSources({}, manifestRoot);
		expect(summaries).toEqual([]);

		const configBackedSummaries = await summarizeIntegrationMockSources(config, manifestRoot);
		expect(configBackedSummaries[0]).toMatchObject({
			name: "render",
			httpRoutes: expect.arrayContaining([expect.objectContaining({ key: "GET /services/{id}" })]),
			tools: expect.arrayContaining([expect.objectContaining({ key: "tool:list_services" })]),
		});
	});
});
