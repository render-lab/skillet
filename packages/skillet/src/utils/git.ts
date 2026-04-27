import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

interface FetchResult {
	localPath: string;
	commitSha: string;
}

export class GitError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "GitError";
	}
}

/**
 * Fetch a subdirectory from a GitHub repo using sparse checkout.
 * Returns the local path where files were placed and the resolved commit SHA.
 */
export async function fetchFromGitHub(
	owner: string,
	repo: string,
	skillPath: string,
	ref = "main",
	destDir: string,
): Promise<FetchResult> {
	const repoUrl = `https://github.com/${owner}/${repo}.git`;
	const tmpDir = path.join(tmpdir(), `skillet-${Date.now()}`);

	await mkdir(tmpDir, { recursive: true });

	try {
		await exec("git", ["init"], { cwd: tmpDir });
		await exec("git", ["remote", "add", "origin", repoUrl], { cwd: tmpDir });
		await exec("git", ["config", "core.sparseCheckout", "true"], { cwd: tmpDir });

		const sparseDir = path.join(tmpDir, ".git", "info");
		await mkdir(sparseDir, { recursive: true });
		const { writeFile } = await import("node:fs/promises");
		await writeFile(path.join(sparseDir, "sparse-checkout"), `${skillPath}\n`);

		try {
			await exec("git", ["fetch", "--depth=1", "origin", ref], { cwd: tmpDir });
		} catch (err) {
			const stderr = (err as { stderr?: string }).stderr ?? "";
			if (stderr.includes("Repository not found")) {
				throw new GitError(
					`Repository not found: github.com/${owner}/${repo}\n  Check that the repo exists and is accessible.`,
					err,
				);
			}
			if (stderr.includes("couldn't find remote ref")) {
				throw new GitError(
					`Branch or tag "${ref}" not found in github.com/${owner}/${repo}`,
					err,
				);
			}
			throw new GitError(
				`Git fetch failed for github.com/${owner}/${repo} (ref: ${ref})\n  ${stderr.trim().split("\n").pop()}`,
				err,
			);
		}

		await exec("git", ["checkout", "FETCH_HEAD"], { cwd: tmpDir });

		const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: tmpDir });
		const commitSha = stdout.trim();

		const srcPath = path.join(tmpDir, skillPath);

		let entries;
		try {
			entries = await readdir(srcPath, { withFileTypes: true });
		} catch {
			throw new GitError(
				`Skill path "${skillPath}" not found in github.com/${owner}/${repo} (ref: ${ref})\n  The repository exists but doesn't contain a "${skillPath}" directory.`,
			);
		}

		if (entries.length === 0) {
			throw new GitError(
				`Skill path "${skillPath}" is empty in github.com/${owner}/${repo} (ref: ${ref})`,
			);
		}

		await mkdir(destDir, { recursive: true });

		for (const entry of entries) {
			await rename(path.join(srcPath, entry.name), path.join(destDir, entry.name));
		}

		return { localPath: destDir, commitSha };
	} finally {
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

const DEFAULT_TAG_TIMEOUT_MS = 5000;

/**
 * List git tags matching a semver-like pattern from a remote repo.
 * Times out after `timeoutMs` (default 5s) to keep passive checks fast.
 */
export async function listRemoteTags(
	owner: string,
	repo: string,
	timeoutMs = DEFAULT_TAG_TIMEOUT_MS,
): Promise<string[]> {
	const repoUrl = `https://github.com/${owner}/${repo}.git`;
	try {
		const { stdout } = await exec("git", ["ls-remote", "--tags", "--refs", repoUrl], {
			timeout: timeoutMs,
		});
		return stdout
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const ref = line.split("\t")[1];
				return ref.replace("refs/tags/", "");
			});
	} catch {
		return [];
	}
}

const DEFAULT_RAW_TIMEOUT_MS = 5000;

/**
 * Fetch a single file from a GitHub repo via raw.githubusercontent.com.
 * Lightweight alternative to sparse checkout — no git clone needed.
 * Returns file content as string, or null on any failure.
 */
export async function fetchRawFile(
	owner: string,
	repo: string,
	ref: string,
	filePath: string,
	timeoutMs = DEFAULT_RAW_TIMEOUT_MS,
): Promise<string | null> {
	const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const res = await fetch(url, { signal: controller.signal });
		clearTimeout(timer);
		if (!res.ok) return null;
		return await res.text();
	} catch {
		return null;
	}
}
