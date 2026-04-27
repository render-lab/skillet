import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Compute a deterministic SHA256 over a directory's file contents,
 * sorted by relative path for reproducibility.
 */
export async function hashDirectory(dirPath: string): Promise<string> {
	const files = await collectFiles(dirPath);
	files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

	const hash = createHash("sha256");
	for (const file of files) {
		hash.update(file.relativePath);
		hash.update(file.content);
	}
	return hash.digest("hex");
}

export function hashString(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

interface FileEntry {
	relativePath: string;
	content: Buffer;
}

async function collectFiles(dirPath: string, prefix = ""): Promise<FileEntry[]> {
	const entries = await readdir(dirPath, { withFileTypes: true });
	const files: FileEntry[] = [];

	for (const entry of entries) {
		const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
		const fullPath = path.join(dirPath, entry.name);

		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			files.push(...(await collectFiles(fullPath, relPath)));
		} else if (entry.isFile()) {
			files.push({ relativePath: relPath, content: await readFile(fullPath) });
		}
	}

	return files;
}
