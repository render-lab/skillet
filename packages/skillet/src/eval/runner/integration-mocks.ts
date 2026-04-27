import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { z } from "zod";
import type { MockIntegrationConfig, MockToolConfig } from "../config/schema.js";
import type { ToolDefinition, ToolHandler } from "../providers/types.js";
import type { EvalIntegrationScenario } from "../schemas/evals.js";
import { extractErrorMessage } from "../utils/error.js";

type JsonObject = Record<string, unknown>;

interface RouteDefinition {
	integration: string;
	method: string;
	path: string;
	params: string[];
	response?: unknown;
	responseFromState?: string;
}

interface ToolMockDefinition {
	integration: string;
	name: string;
	description: string;
	parameters?: JsonObject;
	response?: unknown;
	responseFromState?: string;
}

interface RuntimeIntegration {
	name: string;
	config: MockIntegrationConfig;
	scenario: EvalIntegrationScenario;
	state: JsonObject;
	routes: RouteDefinition[];
	tools: ToolMockDefinition[];
}

export interface IntegrationMockEnvironment {
	tools: ToolDefinition[];
	handlers: Record<string, ToolHandler>;
	instructions: string[];
	outputFiles(): Array<{ path: string; content: string }>;
	cleanup(): Promise<void>;
}

export interface IntegrationMockSummary {
	name: string;
	httpRoutes: Array<{ key: string; params: string[] }>;
	tools: Array<{ key: string; description: string }>;
	errors: string[];
}

export interface IntegrationMockManifest {
	version: 1;
	name: string;
	generatedAt: string;
	sources: {
		openapi: string[];
		mcpServer: string[];
		expose: Array<"http" | "tools">;
	};
	httpRoutes: Array<{
		key: string;
		method: string;
		path: string;
		params: string[];
		response?: unknown;
		responseFromState?: string;
	}>;
	tools: Array<{
		key: string;
		name: string;
		description: string;
		parameters?: JsonObject;
		response?: unknown;
		responseFromState?: string;
	}>;
	errors: string[];
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const DEFAULT_MANIFEST_ROOT = path.join(".skillet-evals", "integrations");

function asArray(value: string | string[] | undefined): string[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function isUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

function githubReadmeUrl(source: string): string | undefined {
	const match = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/.*)?$/i);
	if (!match) return undefined;
	return `https://raw.githubusercontent.com/${match[1]}/${match[2].replace(/\.git$/, "")}/main/README.md`;
}

async function readJsonSource(source: string): Promise<unknown> {
	if (isUrl(source)) {
		const response = await fetch(source);
		if (!response.ok) throw new Error(`Failed to fetch ${source}: ${response.status}`);
		const contentType = response.headers.get("content-type") ?? "";
		const text = await response.text();
		if (!contentType.includes("json") && /^\s*</.test(text)) {
			throw new Error(
				`${source} returned HTML, not JSON. Use a raw OpenAPI JSON/YAML URL or a local spec file.`,
			);
		}
		return JSON.parse(text);
	}
	const text = fs.readFileSync(source, "utf-8");
	if (/^\s*</.test(text)) {
		throw new Error(`${source} contains HTML, not JSON. Use an OpenAPI JSON file.`);
	}
	return JSON.parse(text);
}

async function readTextSource(source: string): Promise<string> {
	const readmeUrl = githubReadmeUrl(source);
	if (isUrl(source) || readmeUrl) {
		const response = await fetch(readmeUrl ?? source);
		if (!response.ok) throw new Error(`Failed to fetch ${source}: ${response.status}`);
		return response.text();
	}
	return fs.readFileSync(source, "utf-8");
}

function routeParams(routePath: string): string[] {
	return Array.from(routePath.matchAll(/\{([^}]+)\}/g)).map((match) => match[1] ?? "");
}

function matchPath(template: string, actualPath: string): Record<string, string> | null {
	const names = routeParams(template);
	const pattern = `^${template.replace(/\{[^}]+\}/g, "([^/]+)")}$`;
	const match = actualPath.match(new RegExp(pattern));
	if (!match) return null;
	return Object.fromEntries(
		names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? "")]),
	);
}

function firstJsonResponse(operation: JsonObject): unknown {
	const responses = operation.responses;
	if (!responses || typeof responses !== "object") return undefined;
	for (const response of Object.values(responses as JsonObject)) {
		if (!response || typeof response !== "object") continue;
		const content = (response as JsonObject).content;
		if (!content || typeof content !== "object") continue;
		const json = (content as JsonObject)["application/json"];
		if (!json || typeof json !== "object") continue;
		const example = (json as JsonObject).example;
		if (example !== undefined) return example;
		const examples = (json as JsonObject).examples;
		if (examples && typeof examples === "object") {
			const first = Object.values(examples as JsonObject)[0];
			if (first && typeof first === "object" && "value" in first)
				return (first as JsonObject).value;
		}
	}
	return undefined;
}

async function importOpenApiRoutes(
	integration: string,
	sources: string[],
): Promise<RouteDefinition[]> {
	const routes: RouteDefinition[] = [];
	for (const source of sources) {
		const spec = (await readJsonSource(source)) as JsonObject;
		const paths = spec.paths;
		if (!paths || typeof paths !== "object") continue;
		for (const [routePath, pathItem] of Object.entries(paths as JsonObject)) {
			if (!pathItem || typeof pathItem !== "object") continue;
			for (const [method, operation] of Object.entries(pathItem as JsonObject)) {
				if (!HTTP_METHODS.has(method) || !operation || typeof operation !== "object") continue;
				routes.push({
					integration,
					method: method.toUpperCase(),
					path: routePath,
					params: routeParams(routePath),
					response: firstJsonResponse(operation as JsonObject),
				});
			}
		}
	}
	return routes;
}

function readJsonFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...readJsonFiles(full));
		} else if (entry.isFile() && entry.name.endsWith(".json")) {
			files.push(full);
		}
	}
	return files;
}

function toolFromDescriptor(
	integration: string,
	descriptor: JsonObject,
): ToolMockDefinition | null {
	const name = descriptor.name;
	if (typeof name !== "string") return null;
	return {
		integration,
		name,
		description:
			typeof descriptor.description === "string" ? descriptor.description : "Mock integration tool",
		parameters:
			descriptor.arguments && typeof descriptor.arguments === "object"
				? (descriptor.arguments as JsonObject)
				: undefined,
	};
}

function jsonSchemaType(type: string): string {
	if (type === "number" || type === "integer" || type === "boolean" || type === "array")
		return type;
	return "string";
}

function importMcpToolsFromReadme(integration: string, content: string): ToolMockDefinition[] {
	const tools: ToolMockDefinition[] = [];
	const lines = content.split(/\r?\n/);
	let current:
		| {
				name: string;
				description: string;
				properties: JsonObject;
				required: string[];
		  }
		| undefined;

	const flush = () => {
		if (!current) return;
		tools.push({
			integration,
			name: current.name,
			description: current.description,
			parameters: {
				type: "object",
				properties: current.properties,
				...(current.required.length > 0 ? { required: current.required } : {}),
			},
		});
		current = undefined;
	};

	for (const line of lines) {
		const toolMatch = line.match(/^-\s+\*\*([a-zA-Z0-9_]+)\*\*\s+-\s+(.+)$/);
		if (toolMatch) {
			flush();
			current = {
				name: toolMatch[1] ?? "",
				description: toolMatch[2] ?? "Mock integration tool",
				properties: {},
				required: [],
			};
			continue;
		}

		if (!current) continue;
		const paramMatch = line.match(
			/^\s*-\s+`([^`]+)`:\s+(.+?)\s+\(([^,)]+)(?:,\s*(required|optional))?\)/i,
		);
		if (!paramMatch) continue;
		const [, paramName, description, type, requiredness] = paramMatch;
		if (!paramName || !description || !type) continue;
		current.properties[paramName] = {
			type: jsonSchemaType(type.toLowerCase()),
			description,
		};
		if (requiredness?.toLowerCase() === "required") current.required.push(paramName);
	}

	flush();
	return tools;
}

export function integrationMockManifestRoot(projectRoot = process.cwd()): string {
	return path.resolve(projectRoot, DEFAULT_MANIFEST_ROOT);
}

function integrationMockManifestPath(rootDir: string, name: string): string {
	return path.join(rootDir, name, "manifest.json");
}

function loadIntegrationMockManifest(
	rootDir: string,
	name: string,
): IntegrationMockManifest | undefined {
	const manifestPath = integrationMockManifestPath(rootDir, name);
	if (!fs.existsSync(manifestPath)) return undefined;
	return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as IntegrationMockManifest;
}

async function importMcpToolDescriptors(
	integration: string,
	sources: string[],
): Promise<ToolMockDefinition[]> {
	const tools: ToolMockDefinition[] = [];
	for (const source of sources) {
		if (isUrl(source)) {
			const readmeUrl = githubReadmeUrl(source);
			if (!readmeUrl) {
				throw new Error(
					`${source} is a URL. Use a GitHub repo URL, a README URL, or a local path containing MCP tool descriptor JSON files.`,
				);
			}
			tools.push(...importMcpToolsFromReadme(integration, await readTextSource(readmeUrl)));
			continue;
		}
		const stat = fs.statSync(source);
		const readmePath = stat.isDirectory() ? path.join(source, "README.md") : undefined;
		if (readmePath && fs.existsSync(readmePath)) {
			tools.push(...importMcpToolsFromReadme(integration, fs.readFileSync(readmePath, "utf-8")));
		}
		const files = stat.isDirectory() ? readJsonFiles(source) : [source];
		for (const file of files) {
			try {
				const descriptor = JSON.parse(fs.readFileSync(file, "utf-8"));
				const tool = toolFromDescriptor(integration, descriptor);
				if (tool) tools.push(tool);
			} catch {
				// Ignore unrelated JSON files in MCP repos.
			}
		}
	}
	return tools;
}

function zodFromJsonSchema(schema: JsonObject | undefined): z.ZodType {
	if (!schema || schema.type !== "object" || !schema.properties) return z.record(z.unknown());
	const required = new Set(Array.isArray(schema.required) ? schema.required : []);
	const shape: Record<string, z.ZodType> = {};
	for (const [name, property] of Object.entries(schema.properties as JsonObject)) {
		const type =
			property && typeof property === "object" ? (property as JsonObject).type : undefined;
		let field: z.ZodType =
			type === "boolean"
				? z.boolean()
				: type === "number" || type === "integer"
					? z.number()
					: type === "array"
						? z.array(z.unknown())
						: type === "object"
							? z.record(z.unknown())
							: z.string();
		if (!required.has(name)) field = field.optional();
		shape[name] = field;
	}
	return z.object(shape).passthrough();
}

function getByStateExpression(
	state: JsonObject,
	expression: string,
	params: JsonObject = {},
): unknown {
	const collectionMatch = expression.match(/^([a-zA-Z0-9_-]+)(?:\[([a-zA-Z0-9_-]+)\])?$/);
	if (!collectionMatch) return undefined;
	const collection = state[collectionMatch[1] ?? ""];
	const paramName = collectionMatch[2];
	if (!paramName) return collection;
	const paramValue = params[paramName];
	if (Array.isArray(collection)) {
		return collection.find((item) => {
			if (!item || typeof item !== "object") return false;
			const record = item as JsonObject;
			return record.id === paramValue || record[`${paramName}Id`] === paramValue;
		});
	}
	if (collection && typeof collection === "object" && typeof paramValue === "string") {
		return (collection as JsonObject)[paramValue];
	}
	return undefined;
}

function routeStateFallback(
	route: RouteDefinition,
	state: JsonObject,
	params: JsonObject,
): unknown {
	const parts = route.path.split("/").filter(Boolean);
	const collectionName = parts.find((part) => !part.startsWith("{"));
	if (!collectionName || route.method !== "GET") return undefined;
	const collection = state[collectionName];
	if (!Array.isArray(collection)) return collection;
	const id = Object.values(params)[0];
	return id === undefined
		? collection
		: collection.find((item) => item && typeof item === "object" && (item as JsonObject).id === id);
}

function toolStateFallback(tool: ToolMockDefinition, state: JsonObject, args: JsonObject): unknown {
	const listMatch = tool.name.match(/^list_([a-zA-Z0-9_-]+)$/);
	if (listMatch) return state[listMatch[1] ?? ""];
	const getMatch = tool.name.match(/^get_([a-zA-Z0-9_-]+)$/);
	if (!getMatch) return undefined;
	const singular = getMatch[1] ?? "";
	const collection = state[`${singular}s`] ?? state[singular];
	if (!Array.isArray(collection)) return collection;
	const id = args.id ?? args[`${singular}Id`];
	return collection.find(
		(item) => item && typeof item === "object" && (item as JsonObject).id === id,
	);
}

function resolveOverride(
	scenario: EvalIntegrationScenario,
	key: string,
	state: JsonObject,
	params: JsonObject,
): unknown {
	const override = scenario.overrides[key];
	if (!override) return undefined;
	if (override.response !== undefined) return override.response;
	if (override.responseFromState) {
		return getByStateExpression(state, override.responseFromState, params);
	}
	return undefined;
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

async function startHttpServer(integrations: RuntimeIntegration[]): Promise<{
	url: string;
	close: () => Promise<void>;
}> {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		for (const integration of integrations) {
			for (const route of integration.routes) {
				if (route.method !== req.method) continue;
				const params = matchPath(route.path, url.pathname);
				if (!params) continue;
				const key = `${route.method} ${route.path}`;
				const body =
					resolveOverride(integration.scenario, key, integration.state, params) ??
					(route.responseFromState
						? getByStateExpression(integration.state, route.responseFromState, params)
						: undefined) ??
					route.response ??
					routeStateFallback(route, integration.state, params);
				if (body === undefined) {
					jsonResponse(res, 404, { error: `No mock response configured for ${key}` });
					return;
				}
				jsonResponse(res, 200, body);
				return;
			}
		}
		jsonResponse(res, 404, { error: "No mock route matched" });
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Mock server did not bind to a port");
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}

async function buildRuntimeIntegration(
	name: string,
	config: MockIntegrationConfig,
	scenario: EvalIntegrationScenario,
	manifest?: IntegrationMockManifest,
): Promise<RuntimeIntegration> {
	const routes = manifest
		? manifest.httpRoutes.map((route) => ({
				integration: name,
				method: route.method,
				path: route.path,
				params: route.params,
				response: route.response,
				responseFromState: route.responseFromState,
			}))
		: config.expose.includes("http")
			? await importOpenApiRoutes(name, asArray(config.openapi))
			: [];
	const tools = manifest
		? manifest.tools.map((tool) => ({
				integration: name,
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				response: tool.response,
				responseFromState: tool.responseFromState,
			}))
		: [
				...(config.expose.includes("tools")
					? await importMcpToolDescriptors(name, asArray(config.mcpServer))
					: []),
				...config.tools.map((tool: MockToolConfig) => ({
					integration: name,
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters as JsonObject | undefined,
					response: tool.response,
					responseFromState: tool.responseFromState,
				})),
			];
	return {
		name,
		config,
		scenario,
		state: { ...scenario.state },
		routes,
		tools,
	};
}

export async function buildIntegrationMockManifest(
	name: string,
	config: MockIntegrationConfig,
): Promise<IntegrationMockManifest> {
	const errors: string[] = [];
	let routes: RouteDefinition[] = [];
	let tools: ToolMockDefinition[] = [];

	if (config.expose.includes("http")) {
		try {
			routes = await importOpenApiRoutes(name, asArray(config.openapi));
		} catch (err) {
			errors.push(`OpenAPI import failed: ${extractErrorMessage(err)}`);
		}
	}

	if (config.expose.includes("tools")) {
		try {
			tools = await importMcpToolDescriptors(name, asArray(config.mcpServer));
		} catch (err) {
			errors.push(`MCP tool import failed: ${extractErrorMessage(err)}`);
		}
	}

	tools.push(
		...config.tools.map((tool: MockToolConfig) => ({
			integration: name,
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters as JsonObject | undefined,
			response: tool.response,
			responseFromState: tool.responseFromState,
		})),
	);

	return {
		version: 1,
		name,
		generatedAt: new Date().toISOString(),
		sources: {
			openapi: asArray(config.openapi),
			mcpServer: asArray(config.mcpServer),
			expose: config.expose,
		},
		httpRoutes: routes.map((route) => ({
			key: `${route.method} ${route.path}`,
			method: route.method,
			path: route.path,
			params: route.params,
			response: route.response,
			responseFromState: route.responseFromState,
		})),
		tools: tools.map((tool) => ({
			key: `tool:${tool.name}`,
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			response: tool.response,
			responseFromState: tool.responseFromState,
		})),
		errors,
	};
}

export async function writeIntegrationMockManifests(
	configs: Record<string, MockIntegrationConfig>,
	rootDir = integrationMockManifestRoot(),
): Promise<IntegrationMockManifest[]> {
	const manifests: IntegrationMockManifest[] = [];
	for (const [name, config] of Object.entries(configs)) {
		const manifest = await buildIntegrationMockManifest(name, config);
		const manifestPath = integrationMockManifestPath(rootDir, name);
		fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
		fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		manifests.push(manifest);
	}
	return manifests;
}

export async function summarizeIntegrationMockSources(
	configs: Record<string, MockIntegrationConfig>,
	rootDir = integrationMockManifestRoot(),
): Promise<IntegrationMockSummary[]> {
	const summaries: IntegrationMockSummary[] = [];
	for (const [name, config] of Object.entries(configs)) {
		const manifest = loadIntegrationMockManifest(rootDir, name);
		const summarySource = manifest ?? (await buildIntegrationMockManifest(name, config));
		summaries.push({
			name,
			httpRoutes: summarySource.httpRoutes.map((route) => ({
				key: route.key,
				params: route.params,
			})),
			tools: summarySource.tools.map((tool) => ({
				key: tool.key,
				description: tool.description,
			})),
			errors: summarySource.errors,
		});
	}
	return summaries;
}

export async function createIntegrationMockEnvironment(
	configs: Record<string, MockIntegrationConfig>,
	scenarios: Record<string, EvalIntegrationScenario>,
	opts: { manifestRoot?: string } = {},
): Promise<IntegrationMockEnvironment> {
	const requested = Object.entries(scenarios).filter(([name]) => configs[name]);
	if (requested.length === 0) {
		return {
			tools: [],
			handlers: {},
			instructions: [],
			outputFiles: () => [],
			cleanup: async () => {},
		};
	}

	const integrations = await Promise.all(
		requested.map(([name, scenario]) => {
			const config = configs[name];
			if (!config) throw new Error(`Integration "${name}" is not configured`);
			return buildRuntimeIntegration(
				name,
				config,
				scenario,
				loadIntegrationMockManifest(opts.manifestRoot ?? integrationMockManifestRoot(), name),
			);
		}),
	);

	const httpIntegrations = integrations.filter((integration) => integration.routes.length > 0);
	const server = httpIntegrations.length > 0 ? await startHttpServer(httpIntegrations) : undefined;

	const tools: ToolDefinition[] = [];
	const handlers: Record<string, ToolHandler> = {};
	for (const integration of integrations) {
		for (const tool of integration.tools) {
			tools.push({
				name: tool.name,
				description: `[${integration.name}] ${tool.description}`,
				parameters: zodFromJsonSchema(tool.parameters),
			});
			handlers[tool.name] = async (args) => {
				try {
					const key = `tool:${tool.name}`;
					const body =
						resolveOverride(integration.scenario, key, integration.state, args) ??
						(tool.responseFromState
							? getByStateExpression(integration.state, tool.responseFromState, args)
							: undefined) ??
						tool.response ??
						toolStateFallback(tool, integration.state, args);
					if (body === undefined) {
						return { error: `No mock response configured for ${key}` };
					}
					return body;
				} catch (err) {
					return { error: extractErrorMessage(err) };
				}
			};
		}
	}

	const instructions: string[] = [];
	if (server) {
		instructions.push(`Integration mock HTTP base URL: ${server.url}`);
	}
	if (tools.length > 0) {
		instructions.push(
			`Integration mock tools available: ${tools.map((tool) => tool.name).join(", ")}`,
		);
	}

	return {
		tools,
		handlers,
		instructions,
		outputFiles: () =>
			integrations.map((integration) => ({
				path: `.skillet/integrations/${integration.name}.json`,
				content: JSON.stringify(
					{
						name: integration.name,
						state: integration.state,
						routes: integration.routes.map((route) => `${route.method} ${route.path}`),
						tools: integration.tools.map((tool) => tool.name),
					},
					null,
					2,
				),
			})),
		cleanup: async () => {
			await server?.close();
		},
	};
}
