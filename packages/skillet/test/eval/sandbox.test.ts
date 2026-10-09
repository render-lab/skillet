import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/eval/commands/run.js";
import { SKILL_DIR_NAME, collectOutputFiles, seedSkill } from "../../src/eval/runner/sandbox.js";
import { createToolHandlers } from "../../src/eval/runner/tools.js";

describe("seedSkill", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
		dirs.length = 0;
	});

	async function tempDir(prefix: string) {
		const dir = await mkdtemp(path.join(tmpdir(), prefix));
		dirs.push(dir);
		return dir;
	}

	async function makeSkill() {
		const skillDir = await tempDir("skillet-skill-");
		await writeFile(path.join(skillDir, "SKILL.md"), "# Skill\nRead references/guide.md.");
		await writeFile(path.join(skillDir, "evals.json"), "{}");
		await mkdir(path.join(skillDir, "references"));
		await writeFile(path.join(skillDir, "references", "guide.md"), "GUIDE_CONTENT");
		await mkdir(path.join(skillDir, "scripts"));
		await writeFile(path.join(skillDir, "scripts", "check.sh"), "echo ok");
		return skillDir;
	}

	it("lets the agent read the skill's references from the sandbox", async () => {
		const skillDir = await makeSkill();
		const sandboxDir = await tempDir("skillet-sandbox-");
		seedSkill(sandboxDir, skillDir);

		const handlers = createToolHandlers(sandboxDir, 5);
		const result = (await handlers.read_file({
			path: `${SKILL_DIR_NAME}/references/guide.md`,
		})) as { content?: string };

		expect(result.content).toBe("GUIDE_CONTENT");
		expect(await readFile(path.join(sandboxDir, SKILL_DIR_NAME, "SKILL.md"), "utf-8")).toContain(
			"# Skill",
		);
		expect(
			await readFile(path.join(sandboxDir, SKILL_DIR_NAME, "scripts", "check.sh"), "utf-8"),
		).toBe("echo ok");
	});

	it("does not copy evals or other files outside the skill layout", async () => {
		const skillDir = await makeSkill();
		const sandboxDir = await tempDir("skillet-sandbox-");
		seedSkill(sandboxDir, skillDir);

		const handlers = createToolHandlers(sandboxDir, 5);
		const listing = (await handlers.list_directory({ path: SKILL_DIR_NAME })) as unknown;

		expect(JSON.stringify(listing)).not.toContain("evals.json");
	});

	it("keeps the seeded skill out of the files sent to the grader", async () => {
		const skillDir = await makeSkill();
		const sandboxDir = await tempDir("skillet-sandbox-");
		seedSkill(sandboxDir, skillDir);
		await writeFile(path.join(sandboxDir, "render.yaml"), "services: []");

		const outputs = collectOutputFiles(sandboxDir).map((f) => f.path);

		expect(outputs).toEqual(["render.yaml"]);
	});
});

describe("buildSystemPrompt", () => {
	it("tells the agent where the skill's files are", () => {
		const prompt = buildSystemPrompt("# Skill");

		expect(prompt).toContain(`\`${SKILL_DIR_NAME}/\``);
		expect(prompt).toContain("references/");
	});
});
