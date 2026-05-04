/**
 * Extract version from a skill's frontmatter. Checks top-level `version`
 * first, then falls back to `metadata.version`. Returns null if neither
 * exists.
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
