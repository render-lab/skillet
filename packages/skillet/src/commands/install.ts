import path from "node:path";
import pc from "picocolors";
import { MANIFEST_FILE, ManifestSchema } from "../schemas/manifest.js";
import { parseSkillSpec } from "../schemas/skill.js";
import { resolveSkill } from "../resolver/github.js";
import { buildGraph, type ResolvedSkill } from "../resolver/graph.js";
import { readLockfile } from "../lockfile/read.js";
import { buildLockfile, writeLockfile } from "../lockfile/write.js";
import { warnOutdated } from "../resolver/outdated.js";
import { fileExists, readJson } from "../utils/fs.js";
import { GitError } from "../utils/git.js";

export async function runInstall() {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	if (!(await fileExists(manifestPath))) {
		console.error(pc.red(`No ${MANIFEST_FILE} found. Run "skillet init" first.`));
		process.exit(1);
	}

	const raw = await readJson(manifestPath);
	const manifest = ManifestSchema.parse(raw);
	const existingLock = await readLockfile(cwd);

	const skillEntries = Object.entries(manifest.skills);
	if (skillEntries.length === 0) {
		console.log(pc.yellow("No skills declared in manifest. Nothing to install."));
		return;
	}

	console.log(pc.cyan(`Installing ${skillEntries.length} skill(s)...\n`));

	const resolved: ResolvedSkill[] = [];
	let failed = 0;

	for (const [id, versionSpec] of skillEntries) {
		const range = typeof versionSpec === "string" ? versionSpec : versionSpec.version;
		const spec = parseSkillSpec(`${id}@${range}`);

		const lockSha = existingLock ? findLockfileSha(existingLock, id) : undefined;

		console.log(pc.gray(`  ${id}@${range}`));

		try {
			const skill = await resolveSkill(spec, { lockfileSha: lockSha });
			resolved.push(skill);
			console.log(pc.green(`    ✓ ${skill.version} (${skill.sha256.slice(0, 12)})`));
		} catch (err) {
			failed++;
			if (err instanceof GitError) {
				console.error(pc.red(`    ✗ ${err.message}`));
			} else {
				console.error(
					pc.red(`    ✗ Failed: ${err instanceof Error ? err.message : err}`),
				);
			}
		}
	}

	if (resolved.length === 0) {
		console.error(pc.red("\nNo skills resolved successfully."));
		process.exit(1);
	}

	const graph = buildGraph(resolved);
	const lockfile = buildLockfile(graph);
	const lockPath = await writeLockfile(cwd, lockfile);

	console.log(
		`\n${pc.green(`Installed ${resolved.length} skill(s).`)} Lockfile: ${pc.bold(path.basename(lockPath))}`,
	);
	if (failed > 0) {
		console.error(pc.yellow(`${failed} skill(s) failed (see errors above).`));
	}

	await warnOutdated(manifest, lockfile);
}

function findLockfileSha(
	lockfile: { resolved: Record<string, { sha256: string }> },
	id: string,
): string | undefined {
	for (const [key, entry] of Object.entries(lockfile.resolved)) {
		if (key.startsWith(`${id}@`)) return entry.sha256;
	}
	return undefined;
}
