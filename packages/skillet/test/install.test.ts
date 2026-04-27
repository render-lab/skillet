import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInstall } from "../src/commands/install.js";
import type { ResolvedSkill } from "../src/resolver/graph.js";
import { LOCKFILE_NAME } from "../src/schemas/lockfile.js";
import { MANIFEST_FILE } from "../src/schemas/manifest.js";

const { resolveSkillMock, warnOutdatedMock } = vi.hoisted(() => ({
	resolveSkillMock: vi.fn(),
	warnOutdatedMock: vi.fn(),
}));

vi.mock("../src/resolver/github.js", () => ({
	resolveSkill: resolveSkillMock,
}));

vi.mock("../src/resolver/outdated.js", () => ({
	warnOutdated: warnOutdatedMock,
}));

function makeSkill(id: string, version: string, sha: string): ResolvedSkill {
	const parts = id.split("/");

	return {
		spec: {
			owner: parts[0],
			repo: parts[1],
			skillName: parts.slice(2).join("/"),
			versionRange: "latest",
		},
		id,
		version,
		sha256: sha,
		commitSha: `${sha}-commit`,
		source: `https://github.com/o/r/tree/main/${id}`,
		localPath: `/tmp/${id}`,
	};
}

describe("runInstall", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-install-"));
		originalCwd = process.cwd();
		process.chdir(tmpDir);
		resolveSkillMock.mockReset();
		warnOutdatedMock.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		process.chdir(originalCwd);
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("preserves existing lock entries for skills that fail to resolve", async () => {
		await writeFile(
			path.join(tmpDir, MANIFEST_FILE),
			`${JSON.stringify(
				{
					name: "test-project",
					skills: {
						"o/r/a": "latest",
						"o/r/b": "latest",
					},
				},
				null,
				2,
			)}\n`,
		);
		await writeFile(
			path.join(tmpDir, LOCKFILE_NAME),
			`${JSON.stringify(
				{
					lockfileVersion: 1,
					resolved: {
						"o/r/a@1.0.0": {
							sha256: "old-a",
							source: "https://github.com/o/r/tree/main/o/r/a",
							commitSha: "old-a-commit",
						},
						"o/r/b@2.0.0": {
							sha256: "old-b",
							source: "https://github.com/o/r/tree/main/o/r/b",
							commitSha: "old-b-commit",
						},
						"o/r/orphan@9.9.9": {
							sha256: "old-orphan",
							source: "https://github.com/o/r/tree/main/o/r/orphan",
							commitSha: "old-orphan-commit",
						},
					},
				},
				null,
				2,
			)}\n`,
		);

		resolveSkillMock.mockImplementation(async ({ skillName }: { skillName: string }) => {
			if (skillName === "a") {
				return makeSkill("o/r/a", "1.1.0", "new-a");
			}

			throw new Error("network down");
		});

		await runInstall();

		const lockfile = JSON.parse(await readFile(path.join(tmpDir, LOCKFILE_NAME), "utf-8")) as {
			resolved: Record<string, { sha256: string }>;
		};

		expect(lockfile.resolved).toEqual({
			"o/r/a@1.1.0": {
				sha256: "new-a",
				source: "https://github.com/o/r/tree/main/o/r/a",
				commitSha: "new-a-commit",
			},
			"o/r/b@2.0.0": {
				sha256: "old-b",
				source: "https://github.com/o/r/tree/main/o/r/b",
				commitSha: "old-b-commit",
			},
		});
		expect(warnOutdatedMock).toHaveBeenCalledOnce();
	});
});
