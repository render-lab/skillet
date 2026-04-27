import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { runAdd } from "./commands/add.js";
import { runEmit } from "./commands/emit.js";
import { runInit } from "./commands/init.js";
import { runInstall } from "./commands/install.js";
import { runStatus } from "./commands/status.js";
import { runUpdate } from "./commands/update.js";
import { runCompare } from "./eval/commands/compare.js";
import { runFixtures } from "./eval/commands/fixtures.js";
import { runGenerate } from "./eval/commands/generate.js";
import { runInit as runEvalInit } from "./eval/commands/init.js";
import { runRun } from "./eval/commands/run.js";
import { runScaffold } from "./eval/commands/scaffold.js";
import { runServe } from "./eval/commands/serve.js";
import { runValidate } from "./eval/commands/validate.js";
import { loadDotenv } from "./eval/config.js";
import { extractErrorMessage } from "./eval/utils/error.js";
import { VERSION } from "./version.js";

const program = new Command();

program.showSuggestionAfterError();
program.showHelpAfterError(`\n${pc.dim("Run the command again with --help for usage.")}`);
program.configureOutput({
	outputError: (str, write) => write(pc.red(str)),
});

function loadEnvForSkill(skill?: string) {
	const dirs = [process.cwd()];
	if (skill) dirs.push(path.resolve(skill));
	loadDotenv(dirs);
}

program
	.name("skillet")
	.description("Toolkit for AI agent skills")
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

const evalProgram = program.command("eval").description("Generate, validate, run, and compare skill evals");

evalProgram
	.command("init")
	.description("Scaffold a skillet.eval.yaml config file interactively")
	.action(() => {
		loadDotenv();
		runEvalInit();
	});

evalProgram
	.command("generate [skill]")
	.description("Auto-generate a starter evals.json from SKILL.md using an LLM")
	.option("--count <n>", "Number of evals to generate", "3")
	.option("--config <path>", "Path to skillet.eval.yaml")
	.action((skill = ".", opts) => {
		loadEnvForSkill(skill);
		runGenerate({ ...opts, skill });
	});

evalProgram
	.command("fixtures [skill]")
	.description("Generate fixture files referenced by evals.json using an LLM")
	.option("--evals <path>", "Path to evals.json")
	.option("--config <path>", "Path to skillet.eval.yaml")
	.action(async (skill = ".", opts) => {
		loadEnvForSkill(skill);
		await runFixtures({ ...opts, skill });
	});

evalProgram
	.command("scaffold [skill]")
	.description("Generate evals and fixture files in one step (generate + fixtures)")
	.option("--count <n>", "Number of evals to generate", "3")
	.option("--config <path>", "Path to skillet.eval.yaml")
	.action(async (skill = ".", opts) => {
		loadEnvForSkill(skill);
		await runScaffold({ ...opts, skill });
	});

evalProgram
	.command("validate [skill]")
	.description("Pre-flight checks: verify skill directory, evals, and API keys")
	.option("--evals <path>", "Path to evals.json")
	.option("--config <path>", "Path to skillet.eval.yaml")
	.action((skill = ".", opts) => {
		loadEnvForSkill(skill);
		runValidate({ ...opts, skill });
	});

evalProgram
	.command("serve [skill]")
	.description("Serve a local dashboard showing eval results history")
	.option("--evals <path>", "Path to evals.json")
	.option("--port <n>", "Port to serve on", "3000")
	.action((skill = ".", opts) => {
		loadEnvForSkill(skill);
		runServe({ ...opts, skill });
	});

evalProgram
	.command("run [skill]")
	.description("Run evals across configured providers")
	.option("--evals <path>", "Path to evals.json (default: <skill>/evals.json)")
	.option("--config <path>", "Path to skillet.eval.yaml")
	.option("--eval-id <ids>", "Comma-separated eval IDs to run")
	.option("--providers <names>", "Comma-separated provider names")
	.option("--model <spec...>", "Model name (repeatable, e.g. gpt-5.2 claude-sonnet-4-6)")
	.option("--output <format>", "Output format: json (default)", "json")
	.option("--runs <n>", "Runs per provider per eval", "1")
	.option("--timeout <seconds>", "Timeout per eval in seconds", "300")
	.option("--concurrency <n>", "Max concurrent eval runs (default: all, max 10)")
	.option("--golden <path>", "Golden benchmark file to compare against for regression")
	.action(async (skill = ".", opts) => {
		loadEnvForSkill(skill);
		try {
			await runRun({ ...opts, skill });
		} catch (err) {
			console.error(`Error: ${extractErrorMessage(err)}`);
			process.exit(1);
		}
	});

evalProgram
	.command("compare <golden> <current>")
	.description("Compare two benchmark JSON files and report pass rate regressions")
	.action((golden, current) => {
		runCompare(golden, current);
	});

program.parse();
