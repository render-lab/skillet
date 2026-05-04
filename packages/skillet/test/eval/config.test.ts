import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/eval/config/loader.js";
import { DEFAULT_MODELS } from "../../src/eval/config/registry.js";

describe("loadConfig", () => {
	let originalCwd: string;
	let originalEnv: NodeJS.ProcessEnv;
	let tmpDir: string;

	beforeEach(async () => {
		originalCwd = process.cwd();
		originalEnv = { ...process.env };
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-config-"));
		process.chdir(tmpDir);
	});

	afterEach(async () => {
		for (const key of Object.keys(process.env)) {
			delete process.env[key];
		}
		Object.assign(process.env, originalEnv);
		process.chdir(originalCwd);
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("throws a helpful error when an explicit config path does not exist", () => {
		expect(() => loadConfig({ configPath: "/definitely/missing/skillet.config.yaml" })).toThrow(
			/Config file not found/,
		);
	});

	it("auto-detects providers from environment variables and applies CLI settings overrides", () => {
		process.env.OPENAI_API_KEY = "openai-key";

		const config = loadConfig({ runs: 3, timeout: 42 });

		expect(config.providers).toEqual([
			{
				name: "openai",
				model: DEFAULT_MODELS.openai,
				apiKey: "openai-key",
			},
		]);
		expect(config.grader).toEqual({
			provider: "openai",
			model: DEFAULT_MODELS.openai,
			apiKey: "openai-key",
		});
		expect(config.settings).toMatchObject({
			maxSteps: 20,
			runsPerProvider: 3,
			timeout: 42,
			temperature: 0,
		});
		expect(config.skillRoots).toEqual([]);
	});

	it("uses config-file providers and honors provider filtering", async () => {
		const configPath = path.join(tmpDir, "custom.eval.yaml");
		process.env.OPENAI_API_KEY = "openai-key";
		process.env.ANTHROPIC_API_KEY = "anthropic-key";

		await writeFile(
			configPath,
			[
				"providers:",
				"  - name: openai",
				"    model: gpt-5.4",
				"    apiKey: ${OPENAI_API_KEY}",
				"  - name: anthropic",
				"    model: claude-sonnet-4-6",
				"grader:",
				"  provider: anthropic",
				"  model: claude-sonnet-4-6",
				"skills:",
				"  roots:",
				"    - ./skills",
				"    - ../shared-skills",
				"settings:",
				"  maxSteps: 7",
				"  timeout: 120",
				"  runsPerProvider: 2",
				"  temperature: 0.3",
				"",
			].join("\n"),
		);

		const config = loadConfig({
			configPath,
			providers: ["anthropic"],
		});

		expect(config.providers).toEqual([
			{
				name: "anthropic",
				model: "claude-sonnet-4-6",
				apiKey: "anthropic-key",
			},
		]);
		expect(config.grader).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-key",
		});
		expect(config.settings).toMatchObject({
			maxSteps: 7,
			timeout: 120,
			runsPerProvider: 2,
			temperature: 0.3,
		});
		expect(config.skillRoots).toEqual([
			path.join(tmpDir, "skills"),
			path.resolve(tmpDir, "../shared-skills"),
		]);
		expect(config.mocks).toEqual({});
	});

	it("resolves mock sources relative to the config file", async () => {
		const configPath = path.join(tmpDir, "nested/custom.config.yaml");
		await mkdir(path.dirname(configPath), { recursive: true });
		await writeFile(
			configPath,
			[
				"providers:",
				"  - name: openai",
				"    model: gpt-5.4",
				"    apiKey: ${OPENAI_API_KEY}",
				"mocks:",
				"  render:",
				"    openapi: ./fixtures/openapi.json",
				"    mcpServer: https://github.com/example/mcp-server",
				"    expose: [http, tools]",
				"",
			].join("\n"),
		);
		process.env.OPENAI_API_KEY = "openai-key";

		const config = loadConfig({ configPath });

		expect(config.mocks.render).toMatchObject({
			openapi: path.join(tmpDir, "nested/fixtures/openapi.json"),
			mcpServer: "https://github.com/example/mcp-server",
			expose: ["http", "tools"],
		});
	});

	it("lets --model overrides replace detected providers and infer missing provider names", () => {
		process.env.OPENAI_API_KEY = "openai-key";
		process.env.ANTHROPIC_API_KEY = "anthropic-key";

		const config = loadConfig({
			models: ["gpt-5.4", "anthropic:claude-sonnet-4-6"],
		});

		expect(config.providers).toEqual([
			{
				name: "openai",
				model: "gpt-5.4",
				apiKey: "openai-key",
			},
			{
				name: "anthropic",
				model: "claude-sonnet-4-6",
				apiKey: "anthropic-key",
			},
		]);
		expect(config.grader).toEqual({
			provider: "openai",
			model: "gpt-5.4",
			apiKey: "openai-key",
		});
	});

	it("throws when configured providers are missing API keys", async () => {
		const configPath = path.join(tmpDir, "missing-key.eval.yaml");

		await writeFile(
			configPath,
			["providers:", "  - name: openai", "    model: gpt-5.4", ""].join("\n"),
		);

		expect(() => loadConfig({ configPath })).toThrow(/No providers configured/);
	});
});
