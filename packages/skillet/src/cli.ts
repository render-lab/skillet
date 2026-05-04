import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { runCompare } from "./eval/commands/compare.js";
import { runFixtures } from "./eval/commands/fixtures.js";
import { runGenerate } from "./eval/commands/generate.js";
import { runInit as runEvalInit } from "./eval/commands/init.js";
import { runMockImport } from "./eval/commands/mock-import.js";
import { runReport } from "./eval/commands/report.js";
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

async function runCliCommand(command: () => void | Promise<void>) {
	try {
		await command();
	} catch (err) {
		console.error(`Error: ${extractErrorMessage(err)}`);
		process.exit(1);
	}
}

function loadEnvForSkills(skills?: string[]) {
	const dirs = [process.cwd()];
	for (const skill of skills ?? []) {
		dirs.push(path.resolve(skill));
	}
	loadDotenv(dirs);
}

program
	.name("skillet")
	.description("Multi-provider skill evals with integration mocks")
	.version(VERSION);

const evalProgram = program
	.command("eval")
	.description("Generate, validate, run, and compare skill evals");

evalProgram
	.command("init")
	.description("Scaffold a skillet.config.yaml config file interactively")
	.action(() =>
		runCliCommand(() => {
			loadDotenv();
			return runEvalInit();
		}),
	);

evalProgram
	.command("generate [skills...]")
	.description("Auto-generate starter evals.json files from SKILL.md using an LLM")
	.option("--count <n>", "Number of evals to generate", "3")
	.option("--config <path>", "Path to skillet.config.yaml")
	.action((skills, opts) =>
		runCliCommand(() => {
			loadEnvForSkills(skills);
			return runGenerate({ ...opts, skills });
		}),
	);

evalProgram
	.command("fixtures [skills...]")
	.description("Generate fixture files referenced by evals.json using an LLM")
	.option("--evals <path>", "Path to evals.json")
	.option("--config <path>", "Path to skillet.config.yaml")
	.action((skills, opts) =>
		runCliCommand(async () => {
			loadEnvForSkills(skills);
			await runFixtures({ ...opts, skills });
		}),
	);

evalProgram
	.command("scaffold [skills...]")
	.description("Generate evals and fixture files in one step (generate + fixtures)")
	.option("--count <n>", "Number of evals to generate", "3")
	.option("--config <path>", "Path to skillet.config.yaml")
	.action((skills, opts) =>
		runCliCommand(async () => {
			loadEnvForSkills(skills);
			await runScaffold({ ...opts, skills });
		}),
	);

evalProgram
	.command("validate [skills...]")
	.description("Pre-flight checks for one or more skills: verify directories, evals, and API keys")
	.option("--evals <path>", "Path to evals.json")
	.option("--config <path>", "Path to skillet.config.yaml")
	.action((skills, opts) =>
		runCliCommand(() => {
			loadEnvForSkills(skills);
			return runValidate({ ...opts, skills });
		}),
	);

evalProgram
	.command("serve [skill]")
	.description("Serve a local dashboard showing eval results history")
	.option("--evals <path>", "Path to evals.json")
	.option("--port <n>", "Port to serve on", "3000")
	.action((skill, opts) =>
		runCliCommand(() => {
			const resolvedSkill = skill ?? ".";
			loadEnvForSkills([resolvedSkill]);
			return runServe({ ...opts, skill: resolvedSkill });
		}),
	);

evalProgram
	.command("report [skill]")
	.description("Generate a static HTML report for local eval results")
	.option("--evals <path>", "Path to evals.json")
	.option("--output <path>", "Output directory", ".skillet-evals/report")
	.action((skill, opts) =>
		runCliCommand(() => {
			const resolvedSkill = skill ?? ".";
			loadEnvForSkills([resolvedSkill]);
			return runReport({ ...opts, skill: resolvedSkill });
		}),
	);

evalProgram
	.command("run [skills...]")
	.description("Run evals across configured providers for one or more skills")
	.option("--evals <path>", "Path to evals.json (default: <skill>/evals.json)")
	.option("--config <path>", "Path to skillet.config.yaml")
	.option("--eval-id <ids>", "Comma-separated eval IDs to run")
	.option("--providers <names>", "Comma-separated provider names")
	.option("--model <spec...>", "Model name (repeatable, e.g. gpt-5.2 claude-sonnet-4-6)")
	.option("--output <format>", "Output format: json (default)", "json")
	.option("--runs <n>", "Runs per provider per eval", "1")
	.option("--timeout <seconds>", "Timeout per eval in seconds", "300")
	.option("--concurrency <n>", "Max concurrent eval runs (default: all, max 10)")
	.option("--golden <path>", "Golden benchmark file to compare against for regression")
	.action((skills, opts) =>
		runCliCommand(async () => {
			loadEnvForSkills(skills);
			await runRun({ ...opts, skills });
		}),
	);

evalProgram
	.command("compare <golden> <current>")
	.description("Compare two benchmark JSON files and report pass rate regressions")
	.action((golden, current) => {
		runCompare(golden, current);
	});

const mockProgram = program.command("mock").description("Manage integration mocks for evals");

mockProgram
	.command("import <kind> <source>")
	.description("Import a mock from an OpenAPI spec or MCP server repo into skillet.config.yaml")
	.option("--name <name>", "Mock name (defaults to source basename)")
	.option("--config <path>", "Path to skillet.config.yaml")
	.action((kind, source, opts) => runCliCommand(() => runMockImport({ kind, source, ...opts })));

program.parse();
