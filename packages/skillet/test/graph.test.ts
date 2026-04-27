import { describe, expect, it } from "vitest";
import { buildGraph, type ResolvedSkill } from "../src/resolver/graph.js";

function makeSkill(id: string, version = "1.0.0", sha = "abc"): ResolvedSkill {
	return {
		spec: { owner: "o", repo: "r", skillName: id, versionRange: "^1.0.0" },
		id,
		version,
		sha256: sha,
		commitSha: "deadbeef",
		source: `https://github.com/o/r/tree/main/${id}`,
		localPath: `/tmp/${id}`,
	};
}

describe("buildGraph", () => {
	it("builds a flat graph from resolved skills", () => {
		const skills = [makeSkill("a"), makeSkill("b"), makeSkill("c")];
		const graph = buildGraph(skills);
		expect(graph.order).toEqual(["a", "b", "c"]);
		expect(graph.nodes.size).toBe(3);
	});

	it("deduplicates identical skills", () => {
		const skills = [makeSkill("a", "1.0.0", "same"), makeSkill("a", "1.0.0", "same")];
		const graph = buildGraph(skills);
		expect(graph.order).toEqual(["a"]);
		expect(graph.nodes.size).toBe(1);
	});

	it("throws on conflicting versions of the same skill", () => {
		const skills = [makeSkill("a", "1.0.0", "sha1"), makeSkill("a", "2.0.0", "sha2")];
		expect(() => buildGraph(skills)).toThrow("Conflicting versions");
	});
});
