import type { ResolvedSkill } from "../resolver/graph.js";
import type { Lockfile, ResolvedEntry } from "../schemas/lockfile.js";
import { parseSkillSpec } from "../schemas/skill.js";

export interface LockedSkillEntry {
	key: string;
	entry: ResolvedEntry;
}

export function getLockedSkillEntry(
	lockfile: Pick<Lockfile, "resolved">,
	id: string,
): LockedSkillEntry | null {
	for (const [key, entry] of Object.entries(lockfile.resolved)) {
		if (key.startsWith(`${id}@`)) {
			return { key, entry };
		}
	}

	return null;
}

export function getLockedSkillSha(
	lockfile: Pick<Lockfile, "resolved">,
	id: string,
): string | undefined {
	return getLockedSkillEntry(lockfile, id)?.entry.sha256;
}

export function makeResolvedSkillFromLockEntry(
	id: string,
	key: string,
	entry: Pick<ResolvedEntry, "sha256" | "commitSha" | "source">,
): ResolvedSkill {
	return {
		spec: parseSkillSpec(id),
		id,
		version: key.split("@").pop() || "unversioned",
		sha256: entry.sha256,
		commitSha: entry.commitSha,
		source: entry.source,
		localPath: "",
	};
}
