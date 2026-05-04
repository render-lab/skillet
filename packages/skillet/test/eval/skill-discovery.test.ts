import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSkillPaths } from "../../src/eval/config/paths.js";
import {
	discoverSkillsFromRoots,
	resolveSkillSelection,
	suggestSkillRoots,
} from "../../src/eval/config/skills.js";

async function createSkill(rootDir: string, relativePath: string) {
	const skillDir = path.join(rootDir, relativePath);
	await mkdir(skillDir, { recursive: true });
	await writeFile(path.join(skillDir, "SKILL.md"), "# test skill\n");
	return skillDir;
}

describe("skill discovery", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-skill-discovery-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("discovers nested skills from configured roots", async () => {
		const rootA = path.join(tmpDir, "skills");
		const rootB = path.join(tmpDir, "fixtures", "skills");
		const skillA = await createSkill(tmpDir, "skills/alpha");
		const skillB = await createSkill(tmpDir, "fixtures/skills/group/beta");

		expect(discoverSkillsFromRoots([rootA, rootB])).toEqual([skillA, skillB]);
	});

	it("uses explicit skills when provided", async () => {
		const explicit = path.join(tmpDir, "custom-skill");
		expect(resolveSkillSelection([explicit], [])).toEqual([path.resolve(explicit)]);
	});

	it("throws when discovery finds no skills", () => {
		expect(() => resolveSkillSelection(undefined, [path.join(tmpDir, "skills")])).toThrow(
			/No skills discovered/,
		);
	});

	it("suggests known skill root conventions from anywhere in the repo", async () => {
		await createSkill(tmpDir, "packages/foo/skills/alpha");
		await createSkill(tmpDir, "fixtures/skills/beta");
		await createSkill(tmpDir, "packages/bar/.agents/skills/gamma");

		expect(suggestSkillRoots(tmpDir)).toEqual([
			path.join("fixtures", "skills"),
			path.join("packages", "bar", ".agents", "skills"),
			path.join("packages", "foo", "skills"),
		]);
	});

	it("falls back to shared parents for custom layouts", async () => {
		await createSkill(tmpDir, "local-skills/alpha");
		await createSkill(tmpDir, "local-skills/beta");

		expect(suggestSkillRoots(tmpDir)).toEqual(["local-skills"]);
	});
});

describe("resolveSkillPaths layout fallback", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-layout-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("prefers the flat <skill>/evals.json layout when both exist", async () => {
		const skillDir = await createSkill(tmpDir, "alpha");
		await writeFile(path.join(skillDir, "evals.json"), "{}");
		await mkdir(path.join(skillDir, "evals"), { recursive: true });
		await writeFile(path.join(skillDir, "evals", "evals.json"), "{}");

		const paths = resolveSkillPaths(skillDir);

		expect(paths.evalsFile).toBe(path.join(skillDir, "evals.json"));
		expect(paths.evalsDir).toBe(skillDir);
	});

	it("falls back to <skill>/evals/evals.json for the skill-creator layout", async () => {
		const skillDir = await createSkill(tmpDir, "beta");
		await mkdir(path.join(skillDir, "evals", "files"), { recursive: true });
		await writeFile(path.join(skillDir, "evals", "evals.json"), "{}");

		const paths = resolveSkillPaths(skillDir);

		expect(paths.evalsFile).toBe(path.join(skillDir, "evals", "evals.json"));
		expect(paths.evalsDir).toBe(path.join(skillDir, "evals"));
	});

	it("returns the flat path when no evals.json exists yet", async () => {
		const skillDir = await createSkill(tmpDir, "gamma");

		const paths = resolveSkillPaths(skillDir);

		expect(paths.evalsFile).toBe(path.join(skillDir, "evals.json"));
		expect(paths.evalsDir).toBe(skillDir);
	});
});
