import path from "node:path";
import pc from "picocolors";
import type { SkillContent } from "../emitter/base.js";
import { getEmitters } from "../emitter/factory.js";
import { readLockfile } from "../lockfile/read.js";
import { getCachedSkill } from "../resolver/cache.js";
import { warnOutdated } from "../resolver/outdated.js";
import {
	MANIFEST_FILE,
	ManifestSchema,
	TARGET_RUNTIMES,
	type TargetRuntime,
} from "../schemas/manifest.js";
import { SkillFrontmatter, parseSkillSpec } from "../schemas/skill.js";
import {
	exitWithMissingLockfile,
	exitWithMissingManifest,
	exitWithUnknownEmitTarget,
} from "../utils/cli-error.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { fileExists, readJson, readText } from "../utils/fs.js";

interface EmitOptions {
	target?: string;
}

export async function runEmit(opts: EmitOptions) {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	if (!(await fileExists(manifestPath))) {
		exitWithMissingManifest("skillet emit");
	}

	const raw = await readJson(manifestPath);
	const manifest = ManifestSchema.parse(raw);
	const lockfile = await readLockfile(cwd);

	if (!lockfile) {
		exitWithMissingLockfile("skillet emit");
	}

	const targets = opts.target
		? opts.target.split(",").map((target) => target.trim())
		: manifest.config.target;
	for (const target of targets) {
		if (!TARGET_RUNTIMES.includes(target as TargetRuntime)) {
			exitWithUnknownEmitTarget(target, [...TARGET_RUNTIMES]);
		}
	}
	const typedTargets = targets as TargetRuntime[];

	const skills = await loadSkillContents(lockfile, manifest);

	if (skills.length === 0) {
		console.log(pc.yellow('No skills found in cache. Run "skillet install" first.'));
		return;
	}

	const emitters = getEmitters(typedTargets);
	const allFiles: string[] = [];

	for (const emitter of emitters) {
		const result = await emitter.emit({
			projectDir: cwd,
			skills,
			strategy: manifest.config.inject,
		});
		allFiles.push(...result.files);
		console.log(
			pc.green(`  ${result.target}: ${result.files.map((f) => path.relative(cwd, f)).join(", ")}`),
		);
	}

	console.log(
		`\n${pc.green(`Emitted ${allFiles.length} file(s) for ${typedTargets.length} target(s).`)}`,
	);

	await warnOutdated(manifest, lockfile);
}

async function loadSkillContents(
	lockfile: { resolved: Record<string, { sha256: string }> },
	manifest: { skills: Record<string, unknown> },
): Promise<SkillContent[]> {
	const skills: SkillContent[] = [];

	for (const [key, entry] of Object.entries(lockfile.resolved)) {
		const id = key.split("@")[0];
		const spec = parseSkillSpec(id);

		const cached = await getCachedSkill(spec.owner, spec.repo, spec.skillName, entry.sha256);
		if (!cached) continue;

		const skillMdPath = path.join(cached, "SKILL.md");
		if (!(await fileExists(skillMdPath))) continue;

		const content = await readText(skillMdPath);
		const { frontmatter, body } = parseFrontmatter(content);

		const parsed = SkillFrontmatter.safeParse(frontmatter);
		const fm = parsed.success ? parsed.data : { name: spec.skillName, description: "" };

		const manifestEntry = manifest.skills[id];
		const inject =
			typeof manifestEntry === "object" && manifestEntry !== null && "inject" in manifestEntry
				? (manifestEntry as { inject?: "eager" | "lazy" }).inject
				: undefined;

		skills.push({ id, frontmatter: fm, body, inject });
	}

	return skills;
}
