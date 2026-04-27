import path from "node:path";
import pc from "picocolors";
import { getLockedSkillEntry } from "../lockfile/entries.js";
import { readLockfile } from "../lockfile/read.js";
import { getCachedSkill } from "../resolver/cache.js";
import { warnOutdated } from "../resolver/outdated.js";
import { MANIFEST_FILE, ManifestSchema } from "../schemas/manifest.js";
import { parseSkillSpec } from "../schemas/skill.js";
import { exitWithMissingManifest, exitWithNoSkillsDeclared } from "../utils/cli-error.js";
import { fileExists, readJson } from "../utils/fs.js";

export async function runStatus() {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	if (!(await fileExists(manifestPath))) {
		exitWithMissingManifest("skillet status");
	}

	const raw = await readJson(manifestPath);
	const manifest = ManifestSchema.parse(raw);
	const lockfile = await readLockfile(cwd);

	const skillEntries = Object.entries(manifest.skills);

	if (skillEntries.length === 0) {
		exitWithNoSkillsDeclared();
	}

	console.log(pc.cyan("Skillet Status\n"));
	console.log(pc.gray(`Manifest: ${MANIFEST_FILE}`));
	console.log(pc.gray(`Targets:  ${manifest.config.target.join(", ")}`));
	console.log(pc.gray(`Inject:   ${manifest.config.inject}\n`));

	const locked = lockfile ? Object.keys(lockfile.resolved) : [];

	for (const [id, versionSpec] of skillEntries) {
		const range = typeof versionSpec === "string" ? versionSpec : versionSpec.version;

		const lockedSkill = lockfile ? getLockedSkillEntry(lockfile, id) : null;
		const lockEntry = lockedSkill?.entry ?? null;

		let status: string;
		let cached = false;

		if (!lockEntry) {
			status = pc.red("not installed");
		} else {
			const spec = parseSkillSpec(id);
			const cachedPath = await getCachedSkill(
				spec.owner,
				spec.repo,
				spec.skillName,
				lockEntry.sha256,
			);
			cached = cachedPath !== null;
			const version = lockedSkill?.key.split("@").pop() || "unknown";
			status = cached ? pc.green(`${version} ✓`) : pc.yellow(`${version} (not cached)`);
		}

		console.log(`  ${pc.bold(id)} ${pc.gray(range)} → ${status}`);

		if (lockEntry?.evalModel) {
			console.log(
				pc.gray(`    eval: ${lockEntry.evalModel} (score: ${lockEntry.evalScore ?? "n/a"})`),
			);
		}
	}

	const manifestIds = new Set(skillEntries.map(([id]) => id));
	for (const lockKey of locked) {
		const id = lockKey.split("@")[0];
		if (!manifestIds.has(id)) {
			console.log(`  ${pc.dim(id)} ${pc.yellow("(in lockfile but not in manifest — orphaned)")}`);
		}
	}

	if (lockfile) {
		await warnOutdated(manifest, lockfile);
	}

	console.log();
}
