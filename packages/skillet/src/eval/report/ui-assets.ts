import fs from "node:fs";
import path from "node:path";

export const EVAL_UI_ASSET_BASE = "/__skillet-eval-ui/";

function findPackageRoot(startDir: string) {
	let current = path.resolve(startDir);
	while (true) {
		if (fs.existsSync(path.join(current, "package.json"))) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			throw new Error("Could not find package root for eval UI assets.");
		}
		current = parent;
	}
}

export function getEvalUiDistDir() {
	const moduleDir =
		typeof __dirname === "string" ? __dirname : path.dirname(process.argv[1] ?? process.cwd());
	const packageRoot = findPackageRoot(moduleDir);
	const assetDir = path.join(packageRoot, "dist", "eval-ui");
	if (!fs.existsSync(assetDir)) {
		throw new Error('Eval UI assets not found. Run "pnpm build" in packages/skillet first.');
	}
	return assetDir;
}

export function getEvalUiIndexPath() {
	return path.join(getEvalUiDistDir(), "index.html");
}
