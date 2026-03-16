import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { MANIFEST_FILE, type Manifest, type TargetRuntime } from "../schemas/manifest.js";
import { fileExists, writeJson } from "../utils/fs.js";

export async function runInit() {
	const cwd = process.cwd();
	const manifestPath = path.join(cwd, MANIFEST_FILE);

	p.intro(pc.cyan("agent-skills init"));

	if (await fileExists(manifestPath)) {
		p.log.warn(`${MANIFEST_FILE} already exists. Aborting.`);
		p.outro("Nothing changed.");
		return;
	}

	const projectName = path.basename(cwd);

	const name = await p.text({
		message: "Project name",
		initialValue: projectName,
		validate: (v) => (v.length === 0 ? "Name is required" : undefined),
	});
	if (p.isCancel(name)) return cancel();

	const targets = await p.multiselect({
		message: "Target runtimes",
		options: [
			{ value: "cursor", label: "Cursor (modern .mdc rules)" },
			{ value: "cursor-legacy", label: "Cursor (legacy .cursorrules)" },
			{ value: "claude-code", label: "Claude Code (CLAUDE.md)" },
			{ value: "codex", label: "Codex (.agents/skills/)" },
			{ value: "windsurf", label: "Windsurf (.windsurfrules)" },
			{ value: "cline", label: "Cline (.clinerules)" },
			{ value: "generic", label: "Generic (agent-context.md)" },
		],
		initialValues: ["cursor", "claude-code"],
		required: true,
	});
	if (p.isCancel(targets)) return cancel();

	const inject = await p.select({
		message: "Injection strategy",
		options: [
			{ value: "eager", label: "Eager — all skills injected upfront" },
			{ value: "lazy", label: "Lazy — metadata only, loaded on demand" },
			{ value: "tiered", label: "Tiered — per-skill override" },
		],
		initialValue: "eager",
	});
	if (p.isCancel(inject)) return cancel();

	const manifest: Manifest = {
		name: name as string,
		version: "1.0.0",
		skills: {},
		config: {
			target: targets as TargetRuntime[],
			inject: inject as Manifest["config"]["inject"],
		},
	};

	await writeJson(manifestPath, manifest);

	p.log.success(`Created ${pc.bold(MANIFEST_FILE)}`);
	p.outro("Add skills with: agent-skills add <owner/repo/skill>");
}

function cancel() {
	p.cancel("Cancelled.");
	process.exit(0);
}
