import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
