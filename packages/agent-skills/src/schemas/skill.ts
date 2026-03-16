import { z } from "zod";

export const SkillFrontmatter = z.object({
	name: z.string(),
	description: z.string(),
	version: z.string().optional(),
	license: z.string().optional(),
	compatibility: z.string().optional(),
	metadata: z
		.object({
			author: z.string().optional(),
			version: z.string().optional(),
			category: z.string().optional(),
		})
		.passthrough()
		.optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

/**
 * Extract version from frontmatter. Checks top-level `version` first,
 * then falls back to `metadata.version`. Returns null if neither exists.
 */
export function extractSkillVersion(fm: Record<string, unknown>): string | null {
	if (typeof fm.version === "string" && fm.version.length > 0) {
		return fm.version;
	}
	const meta = fm.metadata;
	if (meta && typeof meta === "object" && "version" in meta) {
		const v = (meta as Record<string, unknown>).version;
		if (typeof v === "string" && v.length > 0) return v;
	}
	return null;
}

/**
 * Parse a skill specifier like "owner/repo/skill-name@^1.0.0" into parts.
 */
export interface SkillSpecifier {
	owner: string;
	repo: string;
	skillName: string;
	versionRange: string;
}

export function parseSkillSpec(spec: string): SkillSpecifier {
	const [fullName, versionRange = "latest"] = spec.split("@");
	const parts = fullName.split("/");

	if (parts.length < 2) {
		throw new Error(
			`Invalid skill specifier "${spec}". Expected format: owner/repo/skill-name[@version]`,
		);
	}

	if (parts.length === 2) {
		return {
			owner: parts[0],
			repo: parts[0],
			skillName: parts[1],
			versionRange,
		};
	}

	return {
		owner: parts[0],
		repo: parts[1],
		skillName: parts.slice(2).join("/"),
		versionRange,
	};
}

export function formatSkillId(spec: SkillSpecifier): string {
	return `${spec.owner}/${spec.repo}/${spec.skillName}`;
}
