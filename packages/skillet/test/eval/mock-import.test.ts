import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { runMockImport } from "../../src/eval/commands/mock-import.js";

describe("runMockImport", () => {
	let tmpDir: string;
	const originalCwd = process.cwd();

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-mock-import-"));
		process.chdir(tmpDir);
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		process.chdir(originalCwd);
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function writeOpenApiSpec(filePath: string) {
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(
			filePath,
			JSON.stringify({
				openapi: "3.1.0",
				paths: {
					"/services/{id}": {
						get: { responses: { "200": { description: "ok" } } },
					},
				},
			}),
		);
	}

	it("creates skillet.config.yaml and writes the mock entry on first import", async () => {
		const specPath = path.join(tmpDir, "fixtures", "openapi.json");
		await writeOpenApiSpec(specPath);
		const configPath = path.join(tmpDir, "skillet.config.yaml");

		await runMockImport({ kind: "openapi", source: specPath, config: configPath });

		const yamlContent = await readFile(configPath, "utf-8");
		const parsed = YAML.parse(yamlContent);

		expect(parsed.mocks.openapi).toMatchObject({
			openapi: "fixtures/openapi.json",
		});

		const manifest = JSON.parse(
			await readFile(
				path.join(process.cwd(), ".skillet-evals", "mocks", "openapi", "manifest.json"),
				"utf-8",
			),
		);
		expect(manifest.httpRoutes).toEqual([expect.objectContaining({ key: "GET /services/{id}" })]);
	});

	it("respects --name and --config overrides and preserves comments", async () => {
		const configPath = path.join(tmpDir, "custom.config.yaml");
		await writeFile(
			configPath,
			["# Skillet config", "providers:", "  - name: openai", "    model: gpt-5.4", ""].join("\n"),
		);
		const specPath = path.join(tmpDir, "specs", "render.json");
		await writeOpenApiSpec(specPath);

		await runMockImport({
			kind: "openapi",
			source: specPath,
			name: "render",
			config: configPath,
		});

		const yamlContent = await readFile(configPath, "utf-8");
		expect(yamlContent).toContain("# Skillet config");
		const parsed = YAML.parse(yamlContent);
		expect(parsed.mocks.render).toMatchObject({ openapi: "specs/render.json" });
		expect(parsed.providers).toEqual([{ name: "openai", model: "gpt-5.4" }]);
	});

	it("derives the mock name from the source basename when --name is omitted", async () => {
		const specPath = path.join(tmpDir, "stripe-openapi.yaml");
		await writeFile(
			specPath,
			[
				"openapi: 3.1.0",
				"paths:",
				"  /v1/charges:",
				"    get:",
				"      responses:",
				"        '200':",
				"          description: ok",
				"",
			].join("\n"),
		);

		await runMockImport({ kind: "openapi", source: specPath });

		const parsed = YAML.parse(await readFile(path.join(tmpDir, "skillet.config.yaml"), "utf-8"));
		expect(Object.keys(parsed.mocks)).toContain("stripe-openapi");
	});

	it("rejects unsupported mock kinds", async () => {
		await expect(
			runMockImport({ kind: "graphql" as "openapi", source: "ignored" }),
		).rejects.toThrow(/Unknown mock kind/);
	});
});
