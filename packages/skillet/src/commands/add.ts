import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
	getLockedSkillEntry,
	getLockedSkillSha,
	makeResolvedSkillFromLockEntry,
} from "../lockfile/entries.js";
import { readLockfile } from "../lockfile/read.js";
import { buildLockfile, writeLockfile } from "../lockfile/write.js";
import { resolveSkillOrDiscover } from "../resolver/github.js";
import { buildGraph } from "../resolver/graph.js";
import type { ResolvedSkill } from "../resolver/graph.js";
import { MANIFEST_FILE, ManifestSchema } from "../schemas/manifest.js";
import { formatSkillId, parseSkillSpec } from "../schemas/skill.js";
import { exitWithMissingManifest } from "../utils/cli-error.js";
import { fileExists, readJson, writeJson } from "../utils/fs.js";
import { GitError } from "../utils/git.js";

interface AddOptions {
	specs: string[];
	all?: boolean;
}

export async function runAdd(opts: AddOptions) {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	if (!(await fileExists(manifestPath))) {
		exitWithMissingManifest("skillet add <owner/repo/skills/my-skill>");
	}

	const raw = await readJson(manifestPath);
	const manifest = ManifestSchema.parse(raw);
	const existingLock = await readLockfile(cwd);

	const resolved: ResolvedSkill[] = [];
	let failed = 0;

	for (const spec of opts.specs) {
		let parsed: ReturnType<typeof parseSkillSpec>;
		try {
			parsed = parseSkillSpec(spec);
		} catch {
			console.error(pc.red(`\n  Invalid specifier: "${spec}"`));
			console.error(pc.gray("  Expected format: owner/repo/skill-name[@version]"));
			console.error(pc.gray("  Examples:"));
			console.error(pc.gray("    skillet add anthropics/skills/docx"));
			console.error(pc.gray("    skillet add render-oss/skills/render-deploy@^1.0.0\n"));
			failed++;
			continue;
		}

		const id = formatSkillId(parsed);
		console.log(pc.gray(`Resolving ${id}@${parsed.versionRange}...`));

		const lockSha = existingLock ? getLockedSkillSha(existingLock, id) : undefined;

		try {
			const result = await resolveSkillOrDiscover(parsed, { lockfileSha: lockSha });

			if (result.type === "single") {
				resolved.push(result.skill);
				manifest.skills[result.skill.id] = manifestVersion(parsed.versionRange, result.skill);
				console.log(
					pc.green(
						`  + ${result.skill.id}@${result.skill.version} (${result.skill.sha256.slice(0, 12)})`,
					),
				);
			} else {
				const selected = opts.all ? result.skills : await promptSkillSelection(result.skills);
				if (selected.length === 0) {
					console.log(pc.yellow("  No skills selected."));
					continue;
				}
				for (const skill of selected) {
					resolved.push(skill);
					manifest.skills[skill.id] = manifestVersion(parsed.versionRange, skill);
					console.log(pc.green(`  + ${skill.id}@${skill.version} (${skill.sha256.slice(0, 12)})`));
				}
			}
		} catch (err) {
			failed++;
			if (err instanceof GitError) {
				console.error(pc.red(`  ✗ ${err.message}`));
			} else {
				console.error(
					pc.red(`  ✗ Failed to resolve ${id}: ${err instanceof Error ? err.message : err}`),
				);
			}
		}
	}

	if (resolved.length > 0) {
		await writeJson(manifestPath, manifest);
		console.log(pc.gray(`Updated ${MANIFEST_FILE}`));

		const allResolved = [...resolved];
		if (existingLock) {
			for (const id of Object.keys(manifest.skills)) {
				if (allResolved.some((r) => r.id === id)) continue;
				const lockedSkill = getLockedSkillEntry(existingLock, id);
				if (lockedSkill) {
					allResolved.push(makeResolvedSkillFromLockEntry(id, lockedSkill.key, lockedSkill.entry));
				}
			}
		}

		const graph = buildGraph(allResolved);
		const lockfile = buildLockfile(graph);
		const lockPath = await writeLockfile(cwd, lockfile);
		console.log(pc.gray(`Updated ${path.basename(lockPath)}`));
	}

	if (failed > 0 && resolved.length === 0) {
		console.error(pc.red("\nFailed to add any skills."));
		process.exit(1);
	}

	if (resolved.length > 0) {
		console.log(pc.green(`\nAdded ${resolved.length} skill(s).`));
	}
	if (failed > 0) {
		console.error(pc.yellow(`${failed} skill(s) failed (see errors above).`));
	}
}

/**
 * Determine what version string to write to skills.json.
 * If the user explicitly specified a range, use it. Otherwise, use the
 * resolved frontmatter version (or "latest" for unversioned skills).
 */
function manifestVersion(userRange: string, skill: ResolvedSkill): string {
	if (userRange !== "latest") return userRange;
	if (skill.version !== "unversioned") return skill.version;
	return "latest";
}

async function promptSkillSelection(skills: ResolvedSkill[]): Promise<ResolvedSkill[]> {
	console.log(pc.cyan(`\n  Found ${skills.length} skills in this directory:\n`));

	const ALL = "__all__";

	const selected = await p.multiselect({
		message: "Skills to add (space to toggle, enter to confirm)",
		options: [
			{ value: ALL, label: pc.bold("All skills"), hint: `add all ${skills.length}` },
			...skills.map((s) => ({
				value: s.id,
				label: s.id.split("/").pop() || s.id,
				hint: s.id,
			})),
		],
		required: false,
	});

	if (p.isCancel(selected)) {
		return [];
	}

	const selectedIds = new Set(selected as string[]);
	if (selectedIds.has(ALL)) {
		return skills;
	}
	return skills.filter((s) => selectedIds.has(s.id));
}
