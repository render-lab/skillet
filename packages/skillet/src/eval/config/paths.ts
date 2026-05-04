import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml"];

/** Find the project root by walking up from startDir looking for markers. */
export function findProjectRoot(startDir: string): string {
	let dir = path.resolve(startDir);
	while (true) {
		for (const marker of PROJECT_ROOT_MARKERS) {
			if (fs.existsSync(path.join(dir, marker))) return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) return path.resolve(startDir);
		dir = parent;
	}
}

/**
 * Pick the canonical evals.json location for a skill directory.
 *
 * Skillet supports two layouts:
 * - Flat (default for single-skill repos): `<skill>/evals.json` with fixtures
 *   colocated under `<skill>/fixtures/`.
 * - Nested (skill-creator convention): `<skill>/evals/evals.json` with
 *   fixtures under `<skill>/evals/files/`.
 *
 * The flat layout takes precedence when both exist; the nested layout is used
 * as a fallback when only it exists.
 */
function resolveEvalsFile(skillDir: string): string {
	const flat = path.join(skillDir, "evals.json");
	if (fs.existsSync(flat)) return flat;
	const nested = path.join(skillDir, "evals", "evals.json");
	if (fs.existsSync(nested)) return nested;
	return flat;
}

/** Resolve paths within a skill directory by convention. */
export function resolveSkillPaths(skillPath: string, evalsOverride?: string) {
	const abs = path.resolve(skillPath);
	const skillName = path.basename(abs);
	const projectRoot = findProjectRoot(abs);
	const evalsFile = evalsOverride ? path.resolve(evalsOverride) : resolveEvalsFile(abs);
	return {
		skillDir: abs,
		skillName,
		skillFile: path.join(abs, "SKILL.md"),
		evalsFile,
		evalsDir: path.dirname(evalsFile),
		resultsDir: path.join(projectRoot, ".skillet-evals", "results", skillName),
	};
}
