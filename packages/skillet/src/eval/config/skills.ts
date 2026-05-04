import fs from "node:fs";
import path from "node:path";

const KNOWN_ROOT_SUFFIXES = [
	["skills"],
	["fixtures", "skills"],
	[".agents", "skills"],
	[".claude", "skills"],
	[".augment", "skills"],
	[".windsurf", "skills"],
];

function shouldSkipDir(name: string) {
	return name === "node_modules" || name === ".git" || name === ".skillet-evals";
}

function walkSkillDirs(root: string, found: string[]) {
	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return;

	const skillFile = path.join(root, "SKILL.md");
	if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
		found.push(root);
		return;
	}

	const entries = fs
		.readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !shouldSkipDir(entry.name))
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		walkSkillDirs(path.join(root, entry.name), found);
	}
}

export function discoverSkillsFromRoots(roots: string[]): string[] {
	const discovered: string[] = [];
	const seen = new Set<string>();

	for (const root of roots) {
		const absRoot = path.resolve(root);
		const foundInRoot: string[] = [];
		walkSkillDirs(absRoot, foundInRoot);
		for (const skillDir of foundInRoot) {
			const normalized = path.resolve(skillDir);
			if (seen.has(normalized)) continue;
			seen.add(normalized);
			discovered.push(normalized);
		}
	}

	return discovered;
}

function pathEndsWithSegments(candidatePath: string, suffix: string[]) {
	const segments = candidatePath.split(path.sep).filter(Boolean);
	if (segments.length < suffix.length) return false;
	return suffix.every(
		(segment, index) => segments[segments.length - suffix.length + index] === segment,
	);
}

function relativePath(projectDir: string, target: string) {
	const rel = path.relative(projectDir, target);
	return rel === "" ? "." : rel;
}

export function suggestSkillRoots(projectDir: string): string[] {
	const absProjectDir = path.resolve(projectDir);
	const skillDirs = discoverSkillsFromRoots([absProjectDir]);
	if (skillDirs.length === 0) return [];

	const suggested = new Set<string>();

	for (const skillDir of skillDirs) {
		let current = skillDir;
		while (current.startsWith(absProjectDir)) {
			const rel = relativePath(absProjectDir, current);
			if (KNOWN_ROOT_SUFFIXES.some((suffix) => pathEndsWithSegments(rel, suffix))) {
				suggested.add(rel);
			}
			if (current === absProjectDir) break;
			current = path.dirname(current);
		}
	}

	if (suggested.size > 0) {
		return [...suggested].sort((a, b) => a.localeCompare(b));
	}

	const parentCounts = new Map<string, number>();
	for (const skillDir of skillDirs) {
		const parent = path.dirname(skillDir);
		const relParent = relativePath(absProjectDir, parent);
		parentCounts.set(relParent, (parentCounts.get(relParent) ?? 0) + 1);
	}

	const groupedRoots = [...parentCounts.entries()]
		.filter(([, count]) => count > 1)
		.map(([root]) => root)
		.sort((a, b) => a.localeCompare(b));
	if (groupedRoots.length > 0) return groupedRoots;

	return skillDirs.map((skillDir) => relativePath(absProjectDir, path.dirname(skillDir)));
}

export function resolveSkillSelection(
	explicitSkills: string[] | undefined,
	skillRoots: string[],
): string[] {
	if (explicitSkills && explicitSkills.length > 0) {
		return explicitSkills.map((skill) => path.resolve(skill));
	}

	const discovered = discoverSkillsFromRoots(skillRoots);
	if (discovered.length === 0) {
		throw new Error(
			'No skills discovered. Configure "skills.roots" in skillet.config.yaml or pass skill paths explicitly.',
		);
	}

	return discovered;
}
