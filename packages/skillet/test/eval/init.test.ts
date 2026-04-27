import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { confirmMock, multiselectMock, selectMock, textMock } = vi.hoisted(() => ({
	confirmMock: vi.fn(),
	multiselectMock: vi.fn(),
	selectMock: vi.fn(),
	textMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn(() => false),
	confirm: confirmMock,
	multiselect: multiselectMock,
	note: vi.fn(),
	select: selectMock,
	text: textMock,
	log: {
		success: vi.fn(),
		warn: vi.fn(),
	},
}));

import { runInit } from "../../src/eval/commands/init.js";

describe("runInit", () => {
	let tmpDir: string;
	let originalCwd: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-init-"));
		originalCwd = process.cwd();
		originalEnv = { ...process.env };
		process.chdir(tmpDir);
		process.env.OPENAI_API_KEY = "openai-key";

		multiselectMock.mockReset();
		selectMock.mockReset();
		textMock.mockReset();
		confirmMock.mockReset();

		multiselectMock.mockResolvedValueOnce(["openai"]);
		selectMock.mockResolvedValue("gpt-5.4");
		textMock.mockResolvedValueOnce("");
		confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
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

	it("can scaffold a GitHub Actions workflow for evals", async () => {
		await runInit();

		const workflow = await readFile(
			path.join(tmpDir, ".github/workflows/skillet-evals.yml"),
			"utf-8",
		);

		expect(workflow).toContain("name: Skillet evals");
		expect(workflow).toContain("pnpm skillet:validate");
		expect(workflow).toContain("pnpm skillet:run");
		expect(workflow).toContain("Comment Skillet summary on PR");
		expect(workflow).toContain("skillet-eval-results");
	});
});
