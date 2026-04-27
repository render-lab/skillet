import { describe, expect, it } from "vitest";
import { LockfileSchema } from "../src/schemas/lockfile.js";
import { ManifestSchema } from "../src/schemas/manifest.js";
import {
	SkillFrontmatter,
	extractSkillVersion,
	formatSkillId,
	parseSkillSpec,
} from "../src/schemas/skill.js";

describe("ManifestSchema", () => {
	it("parses a valid manifest", () => {
		const result = ManifestSchema.parse({
			name: "my-project",
			version: "1.0.0",
			skills: {
				"owner/repo/skill": "^1.0.0",
			},
			config: {
				target: ["cursor"],
				inject: "eager",
			},
		});
		expect(result.name).toBe("my-project");
		expect(result.skills["owner/repo/skill"]).toBe("^1.0.0");
	});

	it("applies defaults for missing config", () => {
		const result = ManifestSchema.parse({
			name: "minimal",
		});
		expect(result.version).toBe("1.0.0");
		expect(result.skills).toEqual({});
		expect(result.config.target).toEqual(["cursor", "claude-code"]);
		expect(result.config.inject).toBe("eager");
	});

	it("accepts object skill entries with inject override", () => {
		const result = ManifestSchema.parse({
			name: "test",
			skills: {
				"owner/repo/skill": { version: "^2.0.0", inject: "lazy" },
			},
		});
		const entry = result.skills["owner/repo/skill"];
		expect(typeof entry).toBe("object");
	});

	it("does not preserve unsupported top-level manifest fields", () => {
		const result = ManifestSchema.parse({
			name: "test",
			rules: {
				"owner/repo/rule": "^1.0.0",
			},
		});
		expect("rules" in result).toBe(false);
	});

	it("rejects invalid injection strategy", () => {
		expect(() =>
			ManifestSchema.parse({
				name: "test",
				config: { inject: "invalid" },
			}),
		).toThrow();
	});
});

describe("LockfileSchema", () => {
	it("parses a valid lockfile", () => {
		const result = LockfileSchema.parse({
			lockfileVersion: 1,
			resolved: {
				"owner/repo/skill@1.0.0": {
					sha256: "abc123",
					source: "https://github.com/owner/repo",
					commitSha: "deadbeef",
				},
			},
		});
		expect(result.lockfileVersion).toBe(1);
		expect(Object.keys(result.resolved)).toHaveLength(1);
	});

	it("accepts optional eval fields", () => {
		const result = LockfileSchema.parse({
			lockfileVersion: 1,
			model: "claude-sonnet-4-6",
			resolved: {
				"owner/repo/skill@1.0.0": {
					sha256: "abc123",
					source: "https://github.com/owner/repo",
					commitSha: "deadbeef",
					evalScore: 0.97,
					evalModel: "claude-sonnet-4-6",
					behavioralContract: "owner/repo/skill@1.0.0#contract",
				},
			},
		});
		expect(result.model).toBe("claude-sonnet-4-6");
		expect(result.resolved["owner/repo/skill@1.0.0"].evalScore).toBe(0.97);
	});

	it("rejects wrong lockfile version", () => {
		expect(() =>
			LockfileSchema.parse({
				lockfileVersion: 2,
				resolved: {},
			}),
		).toThrow();
	});
});

describe("SkillFrontmatter", () => {
	it("parses valid frontmatter", () => {
		const result = SkillFrontmatter.parse({
			name: "my-skill",
			description: "A useful skill",
		});
		expect(result.name).toBe("my-skill");
	});

	it("accepts optional metadata", () => {
		const result = SkillFrontmatter.parse({
			name: "my-skill",
			description: "A useful skill",
			license: "MIT",
			metadata: { author: "Test", version: "1.0.0" },
		});
		expect(result.license).toBe("MIT");
		expect(result.metadata?.author).toBe("Test");
	});
});

describe("parseSkillSpec", () => {
	it("parses owner/repo/skill without version", () => {
		const result = parseSkillSpec("owner/repo/skill-name");
		expect(result.owner).toBe("owner");
		expect(result.repo).toBe("repo");
		expect(result.skillName).toBe("skill-name");
		expect(result.versionRange).toBe("latest");
	});

	it("parses owner/repo/skill with version", () => {
		const result = parseSkillSpec("owner/repo/skill-name@^1.0.0");
		expect(result.owner).toBe("owner");
		expect(result.repo).toBe("repo");
		expect(result.skillName).toBe("skill-name");
		expect(result.versionRange).toBe("^1.0.0");
	});

	it("parses two-part spec as owner=repo", () => {
		const result = parseSkillSpec("owner/skill-name");
		expect(result.owner).toBe("owner");
		expect(result.repo).toBe("owner");
		expect(result.skillName).toBe("skill-name");
	});

	it("throws on single-part spec", () => {
		expect(() => parseSkillSpec("just-a-name")).toThrow();
	});
});

describe("extractSkillVersion", () => {
	it("returns top-level version", () => {
		expect(extractSkillVersion({ version: "1.2.3" })).toBe("1.2.3");
	});

	it("returns metadata.version as fallback", () => {
		expect(extractSkillVersion({ metadata: { version: "2.0.0" } })).toBe("2.0.0");
	});

	it("prefers top-level version over metadata.version", () => {
		expect(extractSkillVersion({ version: "1.0.0", metadata: { version: "2.0.0" } })).toBe("1.0.0");
	});

	it("returns null when no version is present", () => {
		expect(extractSkillVersion({ name: "no-version" })).toBeNull();
	});

	it("returns null for empty string version", () => {
		expect(extractSkillVersion({ version: "" })).toBeNull();
	});
});

describe("formatSkillId", () => {
	it("formats a skill specifier as owner/repo/skill", () => {
		const result = formatSkillId({
			owner: "owner",
			repo: "repo",
			skillName: "skill-name",
			versionRange: "^1.0.0",
		});
		expect(result).toBe("owner/repo/skill-name");
	});
});
