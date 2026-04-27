import path from "node:path";
import pc from "picocolors";
import { getLockedSkillEntry, makeResolvedSkillFromLockEntry } from "../lockfile/entries.js";
import { readLockfile } from "../lockfile/read.js";
import { buildLockfile, writeLockfile } from "../lockfile/write.js";
import { resolveSkill } from "../resolver/github.js";
import { type ResolvedSkill, buildGraph } from "../resolver/graph.js";
import { warnOutdated } from "../resolver/outdated.js";
import { MANIFEST_FILE, ManifestSchema } from "../schemas/manifest.js";
import { parseSkillSpec } from "../schemas/skill.js";
import { exitWithMissingManifest, exitWithNoSkillsDeclared } from "../utils/cli-error.js";
import { fileExists, readJson } from "../utils/fs.js";
import { GitError } from "../utils/git.js";

export async function runInstall() {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	if (!(await fileExists(manifestPath))) {
		exitWithMissingManifest("skillet install");
	}

	const raw = await readJson(manifestPath);
	const manifest = ManifestSchema.parse(raw);
	const existingLock = await readLockfile(cwd);

	const skillEntries = Object.entries(manifest.skills);
	if (skillEntries.length === 0) {
		exitWithNoSkillsDeclared();
	}

	console.log(pc.cyan(`Installing ${skillEntries.length} skill(s)...\n`));

	const lockfileSkills: ResolvedSkill[] = [];
	let installed = 0;
	let preserved = 0;
	let failed = 0;

	for (const [id, versionSpec] of skillEntries) {
		const range = typeof versionSpec === "string" ? versionSpec : versionSpec.version;
		const spec = parseSkillSpec(`${id}@${range}`);
		const lockedSkill = existingLock ? getLockedSkillEntry(existingLock, id) : null;
		const lockSha = lockedSkill?.entry.sha256;

		console.log(pc.gray(`  ${id}@${range}`));

		try {
			const skill = await resolveSkill(spec, { lockfileSha: lockSha });
			lockfileSkills.push(skill);
			installed++;
			console.log(pc.green(`    ✓ ${skill.version} (${skill.sha256.slice(0, 12)})`));
		} catch (err) {
			failed++;
			if (err instanceof GitError) {
				console.error(pc.red(`    ✗ ${err.message}`));
			} else {
				console.error(pc.red(`    ✗ Failed: ${err instanceof Error ? err.message : err}`));
			}
			if (lockedSkill) {
				lockfileSkills.push(makeResolvedSkillFromLockEntry(id, lockedSkill.key, lockedSkill.entry));
				preserved++;
			}
		}
	}

	if (lockfileSkills.length === 0) {
		console.error(pc.red("\nNo skills resolved successfully."));
		process.exit(1);
	}

	const graph = buildGraph(lockfileSkills);
	const lockfile = buildLockfile(graph);
	const lockPath = await writeLockfile(cwd, lockfile);

	if (installed === 0) {
		console.error(pc.red("\nNo skills resolved successfully."));
		if (preserved > 0) {
			console.error(
				pc.yellow(
					`Preserved ${preserved} previously locked skill(s) in ${path.basename(lockPath)}.`,
				),
			);
		}
		process.exit(1);
	}

	console.log(
		`\n${pc.green(`Installed ${installed} skill(s).`)} Lockfile: ${pc.bold(path.basename(lockPath))}`,
	);
	if (failed > 0) {
		console.error(pc.yellow(`${failed} skill(s) failed (see errors above).`));
	}

	await warnOutdated(manifest, lockfile);
}
