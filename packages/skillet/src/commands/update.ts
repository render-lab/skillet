import path from "node:path";
import pc from "picocolors";
import { readLockfile } from "../lockfile/read.js";
import { buildLockfile, writeLockfile } from "../lockfile/write.js";
import { resolveSkill } from "../resolver/github.js";
import { buildGraph, type ResolvedSkill } from "../resolver/graph.js";
import { MANIFEST_FILE, ManifestSchema } from "../schemas/manifest.js";
import { parseSkillSpec } from "../schemas/skill.js";
import { fileExists, readJson } from "../utils/fs.js";
import { GitError } from "../utils/git.js";

interface UpdateOptions {
	skills?: string[];
}

export async function runUpdate(opts: UpdateOptions) {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	if (!(await fileExists(manifestPath))) {
		console.error(pc.red(`No ${MANIFEST_FILE} found. Run "skillet init" first.`));
		process.exit(1);
	}

	const raw = await readJson(manifestPath);
	const manifest = ManifestSchema.parse(raw);
	const lockfile = await readLockfile(cwd);

	if (!lockfile) {
		console.error(pc.red('No lockfile found. Run "skillet install" first.'));
		process.exit(1);
	}

	const filterIds = opts.skills && opts.skills.length > 0 ? new Set(opts.skills) : null;
	const locked = Object.keys(lockfile.resolved);
	const skillIds = Object.keys(manifest.skills);

	console.log(pc.cyan("Checking for updates...\n"));

	const toCheck = filterIds
		? skillIds.filter((id) => filterIds.has(id))
		: skillIds;

	const resolved: ResolvedSkill[] = [];
	let updated = 0;
	let failed = 0;

	for (const id of toCheck) {
		const lockKey = locked.find((k) => k.startsWith(`${id}@`));
		const lockEntry = lockKey ? lockfile.resolved[lockKey] : null;
		const lockedSha = lockEntry?.sha256;
		const lockedVersion = lockKey?.split("@").pop() ?? "unknown";

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
				console.log(
					pc.green(`  ✓ ${id}  content changed (${skill.sha256.slice(0, 12)})`),
				);
			}
			resolved.push(skill);
		} catch (err) {
			failed++;
			if (err instanceof GitError) {
				console.error(pc.red(`  ✗ ${id}: ${err.message}`));
			} else {
				console.error(pc.red(`  ✗ ${id}: ${err instanceof Error ? err.message : err}`));
			}
			if (lockEntry && lockKey) {
				resolved.push(makeExistingSkill(id, lockKey, lockEntry));
			}
		}
	}

	// Keep skills that weren't checked
	for (const id of skillIds) {
		if (toCheck.includes(id)) continue;
		const lockKey = locked.find((k) => k.startsWith(`${id}@`));
		const lockEntry = lockKey ? lockfile.resolved[lockKey] : null;
		if (lockEntry && lockKey) {
			resolved.push(makeExistingSkill(id, lockKey, lockEntry));
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

function makeExistingSkill(
	id: string,
	key: string,
	entry: { sha256: string; commitSha: string; source: string },
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
