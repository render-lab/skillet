import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectOutputFiles, seedSandbox } from "../../src/eval/runner/sandbox.js";
import { createToolHandlers } from "../../src/eval/runner/tools.js";

describe("bundled skill references", () => {
	let root: string;
	let skill: string;
	let work: string;
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "skillet-seed-"));
		skill = path.join(root, "skill");
		work = path.join(root, "work");
		fs.mkdirSync(path.join(skill, "references", "nested"), { recursive: true });
		fs.mkdirSync(work);
		fs.writeFileSync(path.join(skill, "SKILL.md"), "Read references/nested/cli.md");
		fs.writeFileSync(path.join(skill, "REFERENCE.md"), "Root reference");
		fs.writeFileSync(path.join(skill, "references", "nested", "cli.md"), "Installed CLI guidance");
		fs.writeFileSync(path.join(skill, ".env"), "DO_NOT_COPY=secret");
	});
	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it("makes nested references readable with no fixtures, without collecting unchanged docs as output", async () => {
		const seeded = seedSandbox(work, skill, []);
		await expect(
			createToolHandlers(work, 5).read_file({ path: "references/nested/cli.md" }),
		).resolves.toMatchObject({ content: "Installed CLI guidance" });
		expect(fs.readFileSync(path.join(work, "REFERENCE.md"), "utf8")).toBe("Root reference");
		expect(fs.existsSync(path.join(work, ".env"))).toBe(false);
		expect(collectOutputFiles(work, seeded)).toEqual([]);
		fs.writeFileSync(path.join(work, "answer.txt"), "answer");
		fs.writeFileSync(path.join(work, "REFERENCE.md"), "edited");
		expect(collectOutputFiles(work, seeded)).toEqual(
			expect.arrayContaining([
				{ path: "answer.txt", content: "answer" },
				{ path: "REFERENCE.md", content: "edited" },
			]),
		);
	});

	it("uses the actual skill root with a separate eval directory and preserves fixture placement", () => {
		const evals = path.join(root, "external-evals");
		fs.mkdirSync(path.join(evals, "files"), { recursive: true });
		fs.writeFileSync(path.join(evals, "files", "input.txt"), "fixture");
		seedSandbox(work, evals, ["files/input.txt"], skill);
		expect(fs.readFileSync(path.join(work, "references", "nested", "cli.md"), "utf8")).toBe(
			"Installed CLI guidance",
		);
		expect(fs.readFileSync(path.join(work, "input.txt"), "utf8")).toBe("fixture");
	});

	it("accepts explicitly listed bundled documents but rejects conflicting fixture basenames", () => {
		seedSandbox(work, skill, ["REFERENCE.md"]);
		fs.mkdirSync(path.join(skill, "fixtures"));
		fs.writeFileSync(path.join(skill, "fixtures", "REFERENCE.md"), "different");
		expect(() => seedSandbox(work, skill, ["fixtures/REFERENCE.md"])).toThrow("conflicts");
	});

	it("rejects reference symlinks instead of importing host files", () => {
		fs.symlinkSync(path.join(skill, ".env"), path.join(skill, "references", "secret"));
		expect(() => seedSandbox(work, skill, [])).toThrow("must not be a symlink");
		expect(fs.existsSync(path.join(work, "references", "secret"))).toBe(false);
	});
});
