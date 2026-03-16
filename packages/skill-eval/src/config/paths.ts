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

/** Resolve paths within a skill directory by convention. */
export function resolveSkillPaths(skillPath: string, evalsOverride?: string) {
	const abs = path.resolve(skillPath);
	const skillName = path.basename(abs);
	const projectRoot = findProjectRoot(abs);
	return {
		skillDir: abs,
		skillName,
		skillFile: path.join(abs, "SKILL.md"),
		evalsFile: evalsOverride ? path.resolve(evalsOverride) : path.join(abs, "evals.json"),
		resultsDir: path.join(projectRoot, ".skill-evals", "results", skillName),
	};
}
