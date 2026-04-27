import pc from "picocolors";
import type { Lockfile } from "../schemas/lockfile.js";
import type { Manifest } from "../schemas/manifest.js";
import { extractSkillVersion, parseSkillSpec } from "../schemas/skill.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { fetchRawFile } from "../utils/git.js";

export interface OutdatedSkill {
	id: string;
	locked: string;
	available: string;
}

/**
 * Lightweight outdated check: fetches only SKILL.md via raw.githubusercontent.com
 * and compares frontmatter version. Only checks versioned skills (skips "unversioned").
 */
export async function checkOutdated(
	manifest: Manifest,
	lockfile: Lockfile,
): Promise<OutdatedSkill[]> {
	const outdated: OutdatedSkill[] = [];
	const locked = Object.keys(lockfile.resolved);

	const checks = Object.keys(manifest.skills).map(async (id) => {
		const lockKey = locked.find((k) => k.startsWith(`${id}@`));
		if (!lockKey) return null;

		const lockedVersion = lockKey.split("@").pop() ?? "";
		if (lockedVersion === "unversioned") return null;

		const spec = parseSkillSpec(id);
		const skillMdPath = spec.skillName
			? `${spec.skillName}/SKILL.md`
			: "SKILL.md";

		try {
			const content = await fetchRawFile(spec.owner, spec.repo, "HEAD", skillMdPath);
			if (!content) return null;

			const { frontmatter } = parseFrontmatter(content);
			const remoteVersion = extractSkillVersion(frontmatter);
			if (!remoteVersion) return null;

			if (remoteVersion !== lockedVersion) {
				return { id, locked: lockedVersion, available: remoteVersion };
			}
		} catch {
			// network failure — skip silently
		}

		return null;
	});

	const results = await Promise.all(checks);
	for (const r of results) {
		if (r) outdated.push(r);
	}

	return outdated;
}

/**
 * Print a warning about outdated skills. Best-effort: silently
 * swallows errors (e.g. offline, timeout).
 */
export async function warnOutdated(manifest: Manifest, lockfile: Lockfile): Promise<void> {
	try {
		const outdated = await checkOutdated(manifest, lockfile);
		if (outdated.length === 0) return;

		console.log();
		if (outdated.length === 1) {
			const s = outdated[0];
			console.log(
				pc.yellow(`1 skill has an update available: ${s.id}  ${s.locked} → ${s.available}`),
			);
		} else {
			console.log(pc.yellow(`${outdated.length} skills have updates available:`));
			for (const s of outdated) {
				console.log(pc.yellow(`  ${s.id}  ${s.locked} → ${s.available}`));
			}
		}
		console.log(pc.gray('Run "skillet update" to update.'));
	} catch {
		// best-effort — don't break the main command
	}
}
