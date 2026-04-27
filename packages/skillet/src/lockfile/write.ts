import path from "node:path";
import type { DependencyGraph } from "../resolver/graph.js";
import type { Lockfile } from "../schemas/lockfile.js";
import { LOCKFILE_NAME } from "../schemas/lockfile.js";
import { writeJson } from "../utils/fs.js";

export function buildLockfile(graph: DependencyGraph): Lockfile {
	const resolved: Lockfile["resolved"] = {};

	for (const id of graph.order) {
		const skill = graph.nodes.get(id);
		if (!skill) continue;
		const key = `${id}@${skill.version}`;
		resolved[key] = {
			sha256: skill.sha256,
			source: skill.source,
			commitSha: skill.commitSha,
		};
	}

	return {
		lockfileVersion: 1,
		resolved,
	};
}

export async function writeLockfile(projectDir: string, lockfile: Lockfile): Promise<string> {
	const lockPath = path.join(projectDir, LOCKFILE_NAME);
	await writeJson(lockPath, lockfile);
	return lockPath;
}
