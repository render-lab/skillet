import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { PROVIDER_REGISTRY, loadConfig, resolveSkillPaths } from "../config.js";
import { compareBenchmarks, printComparison } from "./compare.js";
import { printResults } from "../report/console-reporter.js";
import { writeDashboard } from "../report/html-reporter.js";
import { writeBenchmarkJson } from "../report/json-reporter.js";
import { runOrchestrator } from "../runner/orchestrator.js";
import { BenchmarkFileSchema } from "../schemas/benchmark.js";
import { type EvalCase, EvalsFileSchema, getTurns } from "../schemas/evals.js";
import { VERSION } from "../version.js";

export interface RunOpts {
	skill: string;
	evals?: string;
	config?: string;
	evalId?: string;
	providers?: string;
	model?: string[];
	output?: string;
	runs?: string;
	timeout?: string;
	concurrency?: string;
	golden?: string;
}

export function buildSystemPrompt(skillContent: string): string {
	return `You are an AI assistant with access to tools. Follow the skill instructions below to complete the user's task.

<skill_instructions>
${skillContent}
</skill_instructions>

Use the available tools (bash, read_file, write_file, list_directory) to complete the task. Work step by step.`;
}

export async function runRun(opts: RunOpts) {
	const paths = resolveSkillPaths(opts.skill, opts.evals);

	if (!fs.existsSync(paths.skillFile)) {
		console.error(pc.red(`SKILL.md not found at ${paths.skillFile}`));
		process.exit(1);
	}
	if (!fs.existsSync(paths.evalsFile)) {
		console.error(pc.red(`evals.json not found at ${paths.evalsFile}`));
		console.error(
			`\nRun ${pc.bold(`skillet eval generate ${opts.skill}`)} to auto-generate evals from SKILL.md,\nor create evals.json manually.\n`,
		);
		process.exit(1);
	}

	const skillContent = fs.readFileSync(paths.skillFile, "utf-8");
	const systemPrompt = buildSystemPrompt(skillContent);

	const rawEvals = JSON.parse(fs.readFileSync(paths.evalsFile, "utf-8"));
	const evalsFile = EvalsFileSchema.parse(rawEvals);

	const models = opts.model ?? evalsFile.models;
	const config = loadConfig({
		configPath: opts.config,
		providers: opts.providers?.split(","),
		models,
		runs: Number(opts.runs),
		timeout: Number(opts.timeout),
	});

	let evals = evalsFile.evals;
	if (opts.evalId) {
		const ids = opts.evalId.split(",").map(Number);
		evals = evals.filter((e) => ids.includes(e.id));
		if (evals.length === 0) {
			console.error(pc.red(`No evals found with IDs: ${opts.evalId}`));
			process.exit(1);
		}
	}

	printRunHeader(opts, paths, evals, config);

	const result = await runOrchestrator(config, evals, paths.skillDir, systemPrompt, {
		concurrency: opts.concurrency ? Number(opts.concurrency) : undefined,
	});

	printResults(result, evals, config.providers.length);
	writeOutputs(result, config, evalsFile, evals, opts, paths);

	if (opts.golden) {
		const goldenRaw = JSON.parse(fs.readFileSync(opts.golden, "utf-8"));
		const golden = BenchmarkFileSchema.parse(goldenRaw);
		const results = compareBenchmarks(golden.provider_summary, result.providerSummary);
		const failed = printComparison(results, opts.golden);
		if (failed) process.exit(1);
	}
}

function printRunHeader(
	opts: RunOpts,
	paths: ReturnType<typeof resolveSkillPaths>,
	evals: EvalCase[],
	config: ReturnType<typeof loadConfig>,
) {
	console.log(pc.bold(`\n  skillet eval v${VERSION}\n`));
	console.log(`  Skill:     ${paths.skillDir}`);
	console.log(`  Evals:     ${evals.length} eval(s)`);
	console.log(`  Providers:  ${config.providers.map((p) => p.model).join(", ")}`);
	if (config.providers.length === 1) {
		const allEnvKeys = Object.values(PROVIDER_REGISTRY).flatMap((e) => e.envKeys);
		const missing = allEnvKeys.filter((k) => !process.env[k]);
		if (missing.length > 0) {
			console.log(`              ${pc.dim(`Set ${missing.join(", ")} to compare more providers`)}`);
		}
	}
	console.log(`  Runs:      ${config.settings.runsPerProvider} per provider`);
	console.log(`  Grader:    ${config.grader.model}`);
	console.log("");
}

function writeOutputs(
	result: Awaited<ReturnType<typeof runOrchestrator>>,
	config: ReturnType<typeof loadConfig>,
	evalsFile: { skill_name: string },
	evals: { id: number }[],
	opts: RunOpts,
	paths: ReturnType<typeof resolveSkillPaths>,
) {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const resultsDir = paths.resultsDir;
	fs.mkdirSync(resultsDir, { recursive: true });

	const meta = {
		skillName: evalsFile.skill_name,
		skillPath: opts.skill,
		evalsRun: evals.map((e) => e.id),
	};

	console.log(pc.bold("  Output\n"));

	const jsonPath = path.join(resultsDir, `${stamp}.json`);
	writeBenchmarkJson(result, config, meta, jsonPath);
	console.log(`  ${pc.green("✓")} ${jsonPath}`);

	writeDashboard(resultsDir);
	console.log(`  ${pc.green("✓")} ${path.join(resultsDir, "index.html")} ${pc.dim("(dashboard)")}`);

	console.log(
		`\n  ${pc.dim(`Run ${pc.bold(`skillet eval serve ${opts.skill}`)} to view results in the browser`)}\n`,
	);
	console.log(`  ${pc.dim(`Results stored in ${pc.bold(resultsDir)}`)}\n`);
}
