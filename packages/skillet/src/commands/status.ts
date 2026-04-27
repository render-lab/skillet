import path from "node:path";
import pc from "picocolors";
import { readLockfile } from "../lockfile/read.js";
import { MANIFEST_FILE, ManifestSchema } from "../schemas/manifest.js";
import { parseSkillSpec } from "../schemas/skill.js";
import { getCachedSkill } from "../resolver/cache.js";
import { warnOutdated } from "../resolver/outdated.js";
import { fileExists, readJson } from "../utils/fs.js";

export async function runStatus() {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	if (!(await fileExists(manifestPath))) {
		console.error(pc.red(`No ${MANIFEST_FILE} found. Run "skillet init" first.`));
		process.exit(1);
	}

	const raw = await readJson(manifestPath);
	const manifest = ManifestSchema.parse(raw);
	const lockfile = await readLockfile(cwd);

	const skillEntries = Object.entries(manifest.skills);

	if (skillEntries.length === 0) {
		console.log(pc.yellow("No skills declared in manifest."));
		return;
	}

	console.log(pc.cyan("Skillet Status\n"));
	console.log(pc.gray(`Manifest: ${MANIFEST_FILE}`));
	console.log(pc.gray(`Targets:  ${manifest.config.target.join(", ")}`));
	console.log(pc.gray(`Inject:   ${manifest.config.inject}\n`));

	const locked = lockfile ? Object.keys(lockfile.resolved) : [];

	for (const [id, versionSpec] of skillEntries) {
		const range = typeof versionSpec === "string" ? versionSpec : versionSpec.version;

		const lockKey = locked.find((k) => k.startsWith(`${id}@`));
		const lockEntry = lockKey && lockfile ? lockfile.resolved[lockKey] : null;

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
			const version = lockKey?.split("@")[1] || "unknown";
			status = cached
				? pc.green(`${version} ✓`)
				: pc.yellow(`${version} (not cached)`);
		}

		console.log(`  ${pc.bold(id)} ${pc.gray(range)} → ${status}`);

		if (lockEntry?.evalModel) {
			console.log(pc.gray(`    eval: ${lockEntry.evalModel} (score: ${lockEntry.evalScore ?? "n/a"})`));
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
