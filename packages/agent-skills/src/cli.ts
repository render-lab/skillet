import { Command } from "commander";
import { runAdd } from "./commands/add.js";
import { runEmit } from "./commands/emit.js";
import { runInit } from "./commands/init.js";
import { runInstall } from "./commands/install.js";
import { runStatus } from "./commands/status.js";
import { runUpdate } from "./commands/update.js";
import { VERSION } from "./version.js";

const program = new Command();

program
	.name("agent-skills")
	.description("Package manager for AI agent skills")
	.version(VERSION);

program
	.command("init")
	.description("Initialize skills.json in the current project")
	.action(() => runInit());

program
	.command("add <spec...>")
	.description("Add skill dependencies (e.g. owner/repo/skill@^1.0.0)")
	.option("--all", "When a path contains multiple skills, add all without prompting")
	.action((specs, opts) => runAdd({ specs, all: opts.all }));

program
	.command("install")
	.alias("i")
	.description("Install all dependencies from skills.json and update lockfile")
	.action(() => runInstall());

program
	.command("emit")
	.description("Emit context files for target agent runtimes")
	.option("--target <targets>", "Comma-separated targets (cursor, claude-code, codex, windsurf, cline, generic)")
	.action((opts) => runEmit(opts));

program
	.command("update [skills...]")
	.description("Update skills to latest versions matching manifest ranges")
	.action((skills) => runUpdate({ skills }));

program
	.command("status")
	.description("Show installed skills and their state")
	.action(() => runStatus());

program.parse();
