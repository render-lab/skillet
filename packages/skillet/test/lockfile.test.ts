import { describe, expect, it } from "vitest";
import { buildLockfile } from "../src/lockfile/write.js";
import { type ResolvedSkill, buildGraph } from "../src/resolver/graph.js";

function makeSkill(id: string, version: string, sha: string): ResolvedSkill {
	return {
		spec: { owner: "o", repo: "r", skillName: id, versionRange: "^1.0.0" },
		id,
		version,
		sha256: sha,
		commitSha: "abc123",
		source: `https://github.com/o/r/tree/main/${id}`,
		localPath: `/tmp/${id}`,
	};
}

describe("buildLockfile", () => {
	it("creates lockfile from dependency graph", () => {
		const graph = buildGraph([
			makeSkill("o/r/a", "1.0.0", "sha-a"),
			makeSkill("o/r/b", "2.1.0", "sha-b"),
		]);
		const lockfile = buildLockfile(graph);

		expect(lockfile.lockfileVersion).toBe(1);
		expect(Object.keys(lockfile.resolved)).toHaveLength(2);
		expect(lockfile.resolved["o/r/a@1.0.0"]).toEqual({
			sha256: "sha-a",
			source: "https://github.com/o/r/tree/main/o/r/a",
			commitSha: "abc123",
		});
	});

	it("preserves insertion order", () => {
		const graph = buildGraph([
			makeSkill("o/r/z", "1.0.0", "sha-z"),
			makeSkill("o/r/a", "1.0.0", "sha-a"),
		]);
		const lockfile = buildLockfile(graph);
		const keys = Object.keys(lockfile.resolved);
		expect(keys[0]).toBe("o/r/z@1.0.0");
		expect(keys[1]).toBe("o/r/a@1.0.0");
	});
});
