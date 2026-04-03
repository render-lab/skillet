import path from "node:path";
import { Command } from "commander";
import { runCompare } from "./commands/compare.js";
import { runFixtures } from "./commands/fixtures.js";
import { runGenerate } from "./commands/generate.js";
import { runInit } from "./commands/init.js";
import { runRun } from "./commands/run.js";
import { runScaffold } from "./commands/scaffold.js";
import { runServe } from "./commands/serve.js";
import { runValidate } from "./commands/validate.js";
import { loadDotenv } from "./config.js";
import { VERSION } from "./version.js";

const program = new Command();

program.name("skill-eval").description("Provider-agnostic skill evaluation tool").version(VERSION);

function loadEnvForSkill(skill?: string) {
	const dirs = [process.cwd()];
	if (skill) dirs.push(path.resolve(skill));
	loadDotenv(dirs);
}

program
	.command("init")
	.description("Scaffold a skill-eval.yaml config file interactively")
	.action(() => {
		loadDotenv();
		runInit();
	});

program
	.command("generate [skill]")
	.description("Auto-generate a starter evals.json from SKILL.md using an LLM")
	.option("--count <n>", "Number of evals to generate", "3")
	.option("--config <path>", "Path to skill-eval.yaml")
	.action((skill, opts) => {
		loadEnvForSkill(skill);
		runGenerate({ ...opts, skill });
	});

program
	.command("fixtures [skill]")
	.description("Generate fixture files referenced by evals.json using an LLM")
	.option("--evals <path>", "Path to evals.json")
	.option("--config <path>", "Path to skill-eval.yaml")
	.action(async (skill, opts) => {
		loadEnvForSkill(skill);
		await runFixtures({ ...opts, skill });
	});

program
	.command("scaffold [skill]")
	.description("Generate evals and fixture files in one step (generate + fixtures)")
	.option("--count <n>", "Number of evals to generate", "3")
	.option("--config <path>", "Path to skill-eval.yaml")
	.action(async (skill, opts) => {
		loadEnvForSkill(skill);
		await runScaffold({ ...opts, skill });
	});

program
	.command("validate [skill]")
	.description("Pre-flight checks: verify skill directory, evals, and API keys")
	.option("--evals <path>", "Path to evals.json")
	.option("--config <path>", "Path to skill-eval.yaml")
	.action((skill, opts) => {
		loadEnvForSkill(skill);
		runValidate({ ...opts, skill });
	});

program
	.command("serve [skill]")
	.description("Serve a local dashboard showing eval results history")
	.option("--evals <path>", "Path to evals.json")
	.option("--port <n>", "Port to serve on", "3000")
	.action((skill, opts) => {
		loadEnvForSkill(skill);
		runServe({ ...opts, skill });
	});

program
	.command("run [skill]")
	.description("Run evals across configured providers")
	.option("--evals <path>", "Path to evals.json (default: <skill>/evals.json)")
	.option("--config <path>", "Path to skill-eval.yaml")
	.option("--eval-id <ids>", "Comma-separated eval IDs to run")
	.option("--providers <names>", "Comma-separated provider names")
	.option("--model <spec...>", "Model name (repeatable, e.g. gpt-5.2 claude-sonnet-4-6)")
	.option("--output <format>", "Output format: json (default)", "json")
	.option("--runs <n>", "Runs per provider per eval", "1")
	.option("--timeout <seconds>", "Timeout per eval in seconds", "300")
	.option("--concurrency <n>", "Max concurrent eval runs (default: all, max 10)")
	.option("--golden <path>", "Golden benchmark file to compare against for regression")
	.action(async (skill, opts) => {
		loadEnvForSkill(skill);
		try {
			await runRun({ ...opts, skill });
		} catch (err) {
			const pc = await import("picocolors");
			const { extractErrorMessage } = await import("./utils/error.js");
			console.error(pc.default.red(`Error: ${extractErrorMessage(err)}`));
			process.exit(1);
		}
	});

program
	.command("compare <golden> <current>")
	.description("Compare two benchmark JSON files and report pass rate regressions")
	.action((golden, current) => {
		runCompare(golden, current);
	});

program.parse();
