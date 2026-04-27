import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});
