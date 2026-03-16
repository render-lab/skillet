import { coerce, maxSatisfying, valid, validRange } from "semver";

/**
 * Strip leading 'v' from tag names (e.g. "v1.2.3" -> "1.2.3").
 */
export function normalizeTag(tag: string): string | null {
	const v = valid(tag) || valid(coerce(tag));
	return v;
}

/**
 * Given a list of git tags and a semver range, find the best matching version.
 * Returns null if no match.
 */
export function resolveBestVersion(
	tags: string[],
	range: string,
): { tag: string; version: string } | null {
	if (range === "latest") {
		const versions = tags
			.map((t) => ({ tag: t, version: normalizeTag(t) }))
			.filter((v): v is { tag: string; version: string } => v.version !== null);
		if (versions.length === 0) return null;
		versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
		return versions[0];
	}

	if (!validRange(range)) {
		return null;
	}

	const candidates = tags
		.map((t) => ({ tag: t, version: normalizeTag(t) }))
		.filter((v): v is { tag: string; version: string } => v.version !== null);

	const versions = candidates.map((c) => c.version);
	const best = maxSatisfying(versions, range);
	if (!best) return null;

	return candidates.find((c) => c.version === best) ?? null;
}
