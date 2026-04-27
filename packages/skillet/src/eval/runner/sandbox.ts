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

/** Copy eval-referenced files into the sandbox. */
export function seedSandbox(sandboxDir: string, skillDir: string, files: string[]) {
	for (const file of files) {
		const src = path.resolve(skillDir, file);
		const dest = path.join(sandboxDir, path.basename(file));
		if (fs.existsSync(src)) {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.copyFileSync(src, dest);
		}
	}
}

/** Collect files created in the sandbox (for grading context), skipping dependency dirs. */
export function collectOutputFiles(sandboxDir: string): Array<{ path: string; content: string }> {
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
