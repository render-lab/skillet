import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SkillSpecifier } from "../schemas/skill.js";
import { extractSkillVersion, formatSkillId } from "../schemas/skill.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { fileExists, readText } from "../utils/fs.js";
import { fetchFromGitHub } from "../utils/git.js";
import { hashDirectory } from "../utils/hash.js";
import { cacheSkill, getCachedSkill } from "./cache.js";
import type { ResolvedSkill } from "./graph.js";

export interface ResolveOptions {
	/** If set, skip version resolution and use this ref directly */
	ref?: string;
	/** Expected SHA from lockfile — skip fetch if cache hit */
	lockfileSha?: string;
}

/**
 * Read SKILL.md from a local directory and extract the frontmatter version.
 * Returns "unversioned" if no version is declared.
 */
async function readSkillVersion(dir: string): Promise<string> {
	const skillMd = path.join(dir, "SKILL.md");
	if (!(await fileExists(skillMd))) return "unversioned";
	const content = await readText(skillMd);
	const { frontmatter } = parseFrontmatter(content);
	return extractSkillVersion(frontmatter) ?? "unversioned";
}

/**
 * Resolve a single skill from GitHub:
 *   1. Check cache by lockfile SHA
 *   2. Fetch via sparse checkout
 *   3. Read frontmatter version from SKILL.md
 *   4. Hash and cache
 */
export async function resolveSkill(
	spec: SkillSpecifier,
	opts: ResolveOptions = {},
): Promise<ResolvedSkill> {
	const id = formatSkillId(spec);

	if (opts.lockfileSha) {
		const cached = await getCachedSkill(spec.owner, spec.repo, spec.skillName, opts.lockfileSha);
		if (cached) {
			const version = await readSkillVersion(cached);
			return {
				spec,
				id,
				version,
				sha256: opts.lockfileSha,
				commitSha: "",
				source: `https://github.com/${spec.owner}/${spec.repo}`,
				localPath: cached,
			};
		}
	}

	const ref = opts.ref ?? "main";
	const skillPath = spec.skillName;
	const tmpDest = path.join(tmpdir(), `skillet-resolve-${Date.now()}`);
	await mkdir(tmpDest, { recursive: true });

	try {
		const { commitSha } = await fetchFromGitHub(spec.owner, spec.repo, skillPath, ref, tmpDest);

		const version = await readSkillVersion(tmpDest);
		const sha256 = await hashDirectory(tmpDest);
		const localPath = await cacheSkill(tmpDest, spec.owner, spec.repo, spec.skillName, sha256);

		return {
			spec,
			id,
			version,
			sha256,
			commitSha,
			source: `https://github.com/${spec.owner}/${spec.repo}/tree/${commitSha}/${skillPath}`,
			localPath,
		};
	} finally {
		await rm(tmpDest, { recursive: true, force: true }).catch(() => {});
	}
}

export interface DiscoverResult {
	type: "single";
	skill: ResolvedSkill;
}

export interface DiscoverMultipleResult {
	type: "multiple";
	skills: ResolvedSkill[];
}

/**
 * Resolve a spec that might point to a single skill or a directory of skills.
 * If the fetched path has a SKILL.md, it's a single skill.
 * If not, scan subdirectories for SKILL.md and resolve each as a skill.
 */
export async function resolveSkillOrDiscover(
	spec: SkillSpecifier,
	opts: ResolveOptions = {},
): Promise<DiscoverResult | DiscoverMultipleResult> {
	if (opts.lockfileSha) {
		const cached = await getCachedSkill(spec.owner, spec.repo, spec.skillName, opts.lockfileSha);
		if (cached) {
			const id = formatSkillId(spec);
			const version = await readSkillVersion(cached);
			return {
				type: "single",
				skill: {
					spec,
					id,
					version,
					sha256: opts.lockfileSha,
					commitSha: "",
					source: `https://github.com/${spec.owner}/${spec.repo}`,
					localPath: cached,
				},
			};
		}
	}

	const ref = opts.ref ?? "main";
	const skillPath = spec.skillName;
	const tmpDest = path.join(tmpdir(), `skillet-resolve-${Date.now()}`);
	await mkdir(tmpDest, { recursive: true });

	try {
		const { commitSha } = await fetchFromGitHub(spec.owner, spec.repo, skillPath, ref, tmpDest);

		if (await fileExists(path.join(tmpDest, "SKILL.md"))) {
			const version = await readSkillVersion(tmpDest);
			const sha256 = await hashDirectory(tmpDest);
			const id = formatSkillId(spec);
			const localPath = await cacheSkill(tmpDest, spec.owner, spec.repo, spec.skillName, sha256);
			return {
				type: "single",
				skill: {
					spec,
					id,
					version,
					sha256,
					commitSha,
					source: `https://github.com/${spec.owner}/${spec.repo}/tree/${commitSha}/${skillPath}`,
					localPath,
				},
			};
		}

		const entries = await readdir(tmpDest, { withFileTypes: true });
		const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));

		const skills: ResolvedSkill[] = [];
		for (const dir of subdirs) {
			const subPath = path.join(tmpDest, dir.name);
			if (!(await fileExists(path.join(subPath, "SKILL.md")))) continue;

			const childSpec: SkillSpecifier = {
				owner: spec.owner,
				repo: spec.repo,
				skillName: skillPath ? `${skillPath}/${dir.name}` : dir.name,
				versionRange: spec.versionRange,
			};
			const childId = formatSkillId(childSpec);
			const version = await readSkillVersion(subPath);
			const sha256 = await hashDirectory(subPath);
			const localPath = await cacheSkill(subPath, spec.owner, spec.repo, dir.name, sha256);

			skills.push({
				spec: childSpec,
				id: childId,
				version,
				sha256,
				commitSha,
				source: `https://github.com/${spec.owner}/${spec.repo}/tree/${commitSha}/${skillPath}/${dir.name}`,
				localPath,
			});
		}

		if (skills.length === 0) {
			const { GitError } = await import("../utils/git.js");
			throw new GitError(
				`No skills found at "${skillPath}" in github.com/${spec.owner}/${spec.repo} (ref: ${ref})\n  The directory exists but contains no SKILL.md files.`,
			);
		}

		return { type: "multiple", skills };
	} finally {
		await rm(tmpDest, { recursive: true, force: true }).catch(() => {});
	}
}
