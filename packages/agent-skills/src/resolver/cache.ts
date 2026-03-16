import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileExists } from "../utils/fs.js";

const CACHE_ROOT = path.join(homedir(), ".agent-skills", "cache");

export function getCachePath(owner: string, repo: string, skillName: string, sha: string): string {
	return path.join(CACHE_ROOT, owner, repo, skillName, sha);
}

export async function getCachedSkill(
	owner: string,
	repo: string,
	skillName: string,
	sha: string,
): Promise<string | null> {
	const cachePath = getCachePath(owner, repo, skillName, sha);
	const skillMd = path.join(cachePath, "SKILL.md");
	if (await fileExists(skillMd)) {
		return cachePath;
	}
	return null;
}

export async function cacheSkill(
	sourcePath: string,
	owner: string,
	repo: string,
	skillName: string,
	sha: string,
): Promise<string> {
	const cachePath = getCachePath(owner, repo, skillName, sha);
	await mkdir(path.dirname(cachePath), { recursive: true });
	await rm(cachePath, { recursive: true, force: true });
	await cp(sourcePath, cachePath, { recursive: true });
	return cachePath;
}

export async function listCachedVersions(
	owner: string,
	repo: string,
	skillName: string,
): Promise<string[]> {
	const dir = path.join(CACHE_ROOT, owner, repo, skillName);
	try {
		return await readdir(dir);
	} catch {
		return [];
	}
}

export { CACHE_ROOT };
