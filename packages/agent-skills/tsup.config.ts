import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
	entry: ["src/cli.ts"],
	format: ["cjs"],
	target: "node20",
	outDir: "dist",
	clean: true,
	banner: { js: "#!/usr/bin/env node" },
	define: { AGENT_SKILLS_VERSION: JSON.stringify(version) },
});
