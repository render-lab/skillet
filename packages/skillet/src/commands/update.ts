import path from "node:path";
import pc from "picocolors";
import { getLockedSkillEntry, makeResolvedSkillFromLockEntry } from "../lockfile/entries.js";
import { readLockfile } from "../lockfile/read.js";
import { buildLockfile, writeLockfile } from "../lockfile/write.js";
import { resolveSkill } from "../resolver/github.js";
import { type ResolvedSkill, buildGraph } from "../resolver/graph.js";
import { MANIFEST_FILE, ManifestSchema } from "../schemas/manifest.js";
import { parseSkillSpec } from "../schemas/skill.js";
import { exitWithMissingLockfile, exitWithMissingManifest } from "../utils/cli-error.js";
import { fileExists, readJson } from "../utils/fs.js";
import { GitError } from "../utils/git.js";

interface UpdateOptions {
	skills?: string[];
}

export async function runUpdate(opts: UpdateOptions) {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	if (!(await fileExists(manifestPath))) {
		exitWithMissingManifest("skillet update");
	}

	const raw = await readJson(manifestPath);
	const manifest = ManifestSchema.parse(raw);
	const lockfile = await readLockfile(cwd);

	if (!lockfile) {
		exitWithMissingLockfile("skillet update");
	}

	const filterIds = opts.skills && opts.skills.length > 0 ? new Set(opts.skills) : null;
	const locked = Object.keys(lockfile.resolved);
	const skillIds = Object.keys(manifest.skills);

	console.log(pc.cyan("Checking for updates...\n"));

	const toCheck = filterIds ? skillIds.filter((id) => filterIds.has(id)) : skillIds;

	const resolved: ResolvedSkill[] = [];
	let updated = 0;
	let failed = 0;

	for (const id of toCheck) {
		const lockedSkill = getLockedSkillEntry(lockfile, id);
		const lockedSha = lockedSkill?.entry.sha256;
		const lockedVersion = lockedSkill?.key.split("@").pop() ?? "unknown";

		const spec = parseSkillSpec(id);

		try {
			const skill = await resolveSkill(spec);

			if (lockedSha && skill.sha256 === lockedSha) {
				resolved.push(skill);
				continue;
			}

			updated++;
			if (skill.version !== "unversioned" && lockedVersion !== "unversioned") {
				console.log(
					pc.green(`  ✓ ${id}  ${lockedVersion} → ${skill.version} (${skill.sha256.slice(0, 12)})`),
				);
			} else {
				console.log(pc.green(`  ✓ ${id}  content changed (${skill.sha256.slice(0, 12)})`));
			}
			resolved.push(skill);
		} catch (err) {
			failed++;
			if (err instanceof GitError) {
				console.error(pc.red(`  ✗ ${id}: ${err.message}`));
			} else {
				console.error(pc.red(`  ✗ ${id}: ${err instanceof Error ? err.message : err}`));
			}
			if (lockedSkill) {
				resolved.push(makeResolvedSkillFromLockEntry(id, lockedSkill.key, lockedSkill.entry));
			}
		}
	}

	// Keep skills that weren't checked
	for (const id of skillIds) {
		if (toCheck.includes(id)) continue;
		const lockedSkill = getLockedSkillEntry(lockfile, id);
		if (lockedSkill) {
			resolved.push(makeResolvedSkillFromLockEntry(id, lockedSkill.key, lockedSkill.entry));
		}
	}

	if (updated === 0 && failed === 0) {
		console.log(pc.green("All skills are up to date."));
		return;
	}

	const graph = buildGraph(resolved);
	const newLockfile = buildLockfile(graph);
	const lockPath = await writeLockfile(cwd, newLockfile);

	if (updated > 0) {
		console.log(
			`\n${pc.green(`Updated ${updated} skill(s).`)} Lockfile: ${pc.bold(path.basename(lockPath))}`,
		);
	}
	if (failed > 0) {
		console.error(pc.yellow(`${failed} skill(s) failed to update (see errors above).`));
	}
}
