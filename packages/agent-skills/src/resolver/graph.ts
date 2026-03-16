import type { SkillSpecifier } from "../schemas/skill.js";

export interface ResolvedSkill {
	spec: SkillSpecifier;
	id: string;
	version: string;
	sha256: string;
	commitSha: string;
	source: string;
	localPath: string;
}

export interface DependencyGraph {
	nodes: Map<string, ResolvedSkill>;
	order: string[];
}

/**
 * Build a dependency graph from resolved skills.
 * For Phase 1, skills don't declare transitive deps, so this is a flat list
 * with topological order matching insertion order.
 */
export function buildGraph(skills: ResolvedSkill[]): DependencyGraph {
	const nodes = new Map<string, ResolvedSkill>();
	const order: string[] = [];

	for (const skill of skills) {
		if (nodes.has(skill.id)) {
			const existing = nodes.get(skill.id)!;
			if (existing.sha256 !== skill.sha256) {
				throw new Error(
					`Conflicting versions for ${skill.id}: ${existing.version} vs ${skill.version}`,
				);
			}
			continue;
		}
		nodes.set(skill.id, skill);
		order.push(skill.id);
	}

	return { nodes, order };
}
