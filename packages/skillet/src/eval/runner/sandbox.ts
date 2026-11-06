import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"__pycache__",
	".venv",
	"venv",
	"env",
	".env",
	"dist",
	"build",
	".tox",
	".mypy_cache",
	".pytest_cache",
	"site-packages",
	".npm",
	".cache",
]);

const MAX_COLLECTED_FILE = 50 * 1024;
const MAX_TOTAL_COLLECTED = 200 * 1024;

type SeededFiles = Map<string, string>;

function fileHash(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Copy bundled docs with their paths intact; retain legacy fixture basename placement. */
export function seedSandbox(
	sandboxDir: string,
	fixturesDir: string,
	files: string[],
	skillDir = fixturesDir,
): SeededFiles {
	const seeded: SeededFiles = new Map();
	function copyReference(source: string, relative: string) {
		const stat = fs.lstatSync(source);
		if (stat.isSymbolicLink()) {
			throw new Error(`Bundled reference must not be a symlink: ${relative}`);
		}
		const dest = path.join(sandboxDir, relative);
		if (stat.isDirectory()) {
			for (const child of fs.readdirSync(source)) {
				copyReference(path.join(source, child), path.join(relative, child));
			}
		} else if (stat.isFile()) {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.copyFileSync(source, dest);
			seeded.set(relative, fileHash(dest));
		}
	}
	for (const entry of fs.readdirSync(skillDir)) {
		if (entry.endsWith(".md") || entry === "references") {
			copyReference(path.join(skillDir, entry), entry);
		}
	}
	for (const file of files) {
		const src = path.resolve(fixturesDir, file);
		const relative = path.basename(file);
		const dest = path.join(sandboxDir, relative);
		if (seeded.has(relative)) {
			if (fs.existsSync(src) && fileHash(src) === seeded.get(relative)) continue;
			throw new Error(`Fixture conflicts with bundled reference: ${file}`);
		}
		if (fs.existsSync(src)) {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.copyFileSync(src, dest);
		}
	}
	return seeded;
}

/** Collect files created in the sandbox (for grading context), skipping dependency dirs. */
export function collectOutputFiles(
	sandboxDir: string,
	seeded: SeededFiles = new Map(),
): Array<{ path: string; content: string }> {
	const results: Array<{ path: string; content: string }> = [];
	let totalSize = 0;

	function walk(dir: string) {
		if (totalSize >= MAX_TOTAL_COLLECTED) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (totalSize >= MAX_TOTAL_COLLECTED) break;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				walk(full);
			} else {
				try {
					const relative = path.relative(sandboxDir, full);
					if (seeded.has(relative) && seeded.get(relative) === fileHash(full)) continue;
					const stat = fs.statSync(full);
					if (stat.size > MAX_COLLECTED_FILE) {
						results.push({
							path: path.relative(sandboxDir, full),
							content: `[file too large: ${Math.round(stat.size / 1024)}KB]`,
						});
						continue;
					}
					const content = fs.readFileSync(full, "utf-8");
					results.push({ path: path.relative(sandboxDir, full), content });
					totalSize += content.length;
				} catch {
					// skip binary files
				}
			}
		}
	}

	walk(sandboxDir);
	return results;
}
