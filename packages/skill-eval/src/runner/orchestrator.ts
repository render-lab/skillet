import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import type { ResolvedConfig } from "../config/schema.js";
import { gradeRun } from "../grader/grader.js";
import { createProvider } from "../providers/factory.js";
import { estimateCost } from "../providers/pricing.js";
import type { LLMProvider } from "../providers/types.js";
import type { BenchmarkRun } from "../schemas/benchmark.js";
import type { EvalCase } from "../schemas/evals.js";
import type { GradingResult } from "../schemas/grading.js";
import { withTimeout } from "../utils/async.js";
import { extractErrorMessage } from "../utils/error.js";
import { mean, sleep, stddev } from "../utils/math.js";
import { rateColor } from "../utils/rate.js";
import { runAgentLoop } from "./agent-loop.js";
import { Spinner } from "./spinner.js";
import { collectOutputFiles, createToolHandlers, defaultTools, seedSandbox } from "./tools.js";
import { createTurnChecker } from "./turn-check.js";

export interface RunEntry {
	evalCase: EvalCase;
	provider: LLMProvider;
	runNumber: number;
}

export interface OrchestratorResult {
	runs: BenchmarkRun[];
	providerSummary: Record<
		string,
		{
			pass_rate: { mean: number; stddev: number };
			time_seconds: { mean: number; stddev: number };
			total_tokens: { mean: number; stddev: number };
			cost_usd: { mean: number; stddev: number };
		}
	>;
}

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;
const MAX_CONCURRENCY = 10;

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 529]);
const RETRYABLE_MESSAGES = ["rate limit", "overloaded", "unavailable", "high demand"];

function isRetryable(err: unknown): boolean {
	const e = err as Record<string, unknown> | undefined;
	const status = (e?.status ?? e?.code ?? (e?.error as Record<string, unknown>)?.code) as
		| number
		| undefined;
	if (typeof status === "number" && RETRYABLE_STATUS_CODES.has(status)) return true;
	const msg = String((err as Error)?.message ?? "").toLowerCase();
	return RETRYABLE_MESSAGES.some((m) => msg.includes(m));
}

function taskId(entry: RunEntry): string {
	return `${entry.evalCase.id}-${entry.provider.modelId}-${entry.runNumber}`;
}

function taskLabel(entry: RunEntry): string {
	return `eval ${entry.evalCase.id} · ${entry.provider.modelId} · r${entry.runNumber}`;
}

function buildFailureResult(entry: RunEntry, errMsg: string): BenchmarkRun {
	return {
		eval_id: entry.evalCase.id,
		provider: entry.provider.name,
		model: entry.provider.modelId,
		run_number: entry.runNumber,
		result: {
			pass_rate: 0,
			passed: 0,
			failed: entry.evalCase.assertions.length,
			total: entry.evalCase.assertions.length,
			time_seconds: 0,
			input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0,
			tool_calls: 0,
			errors: 1,
			cost_usd: 0,
		},
		expectations: entry.evalCase.assertions.map((a) => ({
			text: a,
			passed: false,
			evidence: `Error: ${errMsg}`,
		})),
		claims: [],
		eval_feedback: null,
		error: errMsg,
	};
}

function computeProviderSummary(runs: BenchmarkRun[]): OrchestratorResult["providerSummary"] {
	const grouped = new Map<string, BenchmarkRun[]>();
	for (const run of runs) {
		const key = run.model;
		if (!grouped.has(key)) grouped.set(key, []);
		grouped.get(key)?.push(run);
	}

	const summary: OrchestratorResult["providerSummary"] = {};
	for (const [key, modelRuns] of grouped) {
		const stat = (fn: (r: BenchmarkRun) => number) => ({
			mean: mean(modelRuns.map(fn)),
			stddev: stddev(modelRuns.map(fn)),
		});
		summary[key] = {
			pass_rate: stat((r) => r.result.pass_rate),
			time_seconds: stat((r) => r.result.time_seconds),
			total_tokens: stat((r) => r.result.total_tokens),
			cost_usd: stat((r) => r.result.cost_usd),
		};
	}
	return summary;
}

function formatSuccessLine(
	completed: number,
	total: number,
	entry: RunEntry,
	result: BenchmarkRun,
): string {
	const r = result.result;
	const passColor = rateColor(r.pass_rate);
	return (
		`  ${pc.green("✓")} [${completed}/${total}] ` +
		`eval ${entry.evalCase.id} · ${entry.provider.modelId} · ` +
		`run ${entry.runNumber} · ` +
		`${passColor(`${(r.pass_rate * 100).toFixed(0)}%`)} ${pc.dim(`(${r.passed}/${r.total})`)} · ` +
		`${pc.dim(`${r.time_seconds.toFixed(1)}s · ${r.total_tokens} tok · $${r.cost_usd.toFixed(4)} · ${r.tool_calls} calls`)}`
	);
}

export async function runOrchestrator(
	config: ResolvedConfig,
	evals: EvalCase[],
	skillDir: string,
	systemPrompt: string,
	opts: {
		concurrency?: number;
		onProgress?: (msg: string) => void;
	} = {},
): Promise<OrchestratorResult> {
	const { onProgress } = opts;
	const log = onProgress ?? ((msg: string) => process.stdout.write(`${msg}\n`));

	const graderProvider = createProvider({
		name: config.grader.provider,
		model: config.grader.model,
		apiKey: config.grader.apiKey,
	});

	const matrix: RunEntry[] = [];
	for (const evalCase of evals) {
		for (const providerConfig of config.providers) {
			const provider = createProvider(providerConfig);
			for (let run = 1; run <= config.settings.runsPerProvider; run++) {
				matrix.push({ evalCase, provider, runNumber: run });
			}
		}
	}

	const concurrency = opts.concurrency ?? Math.min(matrix.length, MAX_CONCURRENCY);

	log(
		pc.bold(
			`Running ${matrix.length} eval(s): ${evals.length} eval(s) × ${config.providers.length} provider(s) × ${config.settings.runsPerProvider} run(s)`,
		),
	);

	const results: BenchmarkRun[] = [];
	const spinner = new Spinner();
	let completed = 0;

	async function executeOne(entry: RunEntry): Promise<BenchmarkRun> {
		const evalTimeoutMs = config.settings.timeout * 1000;
		const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-eval-"));

		try {
			seedSandbox(sandboxDir, skillDir, entry.evalCase.files);
			const id = taskId(entry);

			return await withTimeout(
				(async () => {
					const turns =
						entry.evalCase.turns ?? (entry.evalCase.prompt ? [entry.evalCase.prompt] : []);
					const agentRun = await runAgentLoop({
						provider: entry.provider,
						system: systemPrompt,
						turns,
						tools: defaultTools,
						toolHandlers: createToolHandlers(sandboxDir, config.settings.timeout),
						maxSteps: config.settings.maxSteps,
						temperature: config.settings.temperature,
						onActivity: (detail) => spinner.detail(id, detail),
						checkTurnRelevance: turns.length > 1 ? createTurnChecker(graderProvider) : undefined,
					});

					const outputFiles = collectOutputFiles(sandboxDir);

					spinner.detail(id, "grading…");
					const grading: GradingResult = await gradeRun(
						graderProvider,
						entry.evalCase,
						agentRun,
						outputFiles,
					);

					const cost = estimateCost(
						entry.provider.modelId,
						agentRun.totalInputTokens,
						agentRun.totalOutputTokens,
					);

					return {
						eval_id: entry.evalCase.id,
						provider: entry.provider.name,
						model: entry.provider.modelId,
						run_number: entry.runNumber,
						result: {
							pass_rate: grading.pass_rate,
							passed: grading.passed,
							failed: grading.failed,
							total: grading.total,
							time_seconds: agentRun.totalLatencyMs / 1000,
							input_tokens: agentRun.totalInputTokens,
							output_tokens: agentRun.totalOutputTokens,
							total_tokens: agentRun.totalInputTokens + agentRun.totalOutputTokens,
							tool_calls: agentRun.totalToolCalls,
							errors: agentRun.errors,
							cost_usd: cost,
						},
						expectations: grading.expectations,
						claims: grading.claims,
						eval_feedback: grading.eval_feedback,
						error: null,
					};
				})(),
				evalTimeoutMs,
				`Eval timed out after ${config.settings.timeout}s`,
			);
		} finally {
			fs.rmSync(sandboxDir, { recursive: true, force: true });
		}
	}

	async function runTask(entry: RunEntry): Promise<void> {
		const id = taskId(entry);
		spinner.track(id, taskLabel(entry));

		let attempt = 0;
		while (true) {
			try {
				const result = await executeOne(entry);
				results.push(result);
				completed++;
				spinner.succeed(id, formatSuccessLine(completed, matrix.length, entry, result));
				return;
			} catch (err) {
				attempt++;
				const errMsg = extractErrorMessage(err);

				if (isRetryable(err) && attempt <= MAX_RETRIES) {
					const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
					spinner.detail(
						id,
						`retrying in ${(delay / 1000).toFixed(0)}s (${attempt + 1}/${MAX_RETRIES + 1})`,
					);
					await sleep(delay);
					spinner.untrack(id);
					spinner.track(id, taskLabel(entry));
					continue;
				}

				results.push(buildFailureResult(entry, errMsg));
				completed++;
				spinner.succeed(
					id,
					`  ${pc.red("✗")} [${completed}/${matrix.length}] ` +
						`eval ${entry.evalCase.id} · ${entry.provider.modelId} · ` +
						`run ${entry.runNumber} · ${pc.red(errMsg)}`,
				);
				return;
			}
		}
	}

	spinner.start(matrix.length);

	const workers = Array.from({ length: Math.min(concurrency, matrix.length) }, async () => {
		while (matrix.length > 0) {
			const entry = matrix.shift();
			if (!entry) break;
			await runTask(entry);
		}
	});
	await Promise.all(workers);

	spinner.stop();

	return { runs: results, providerSummary: computeProviderSummary(results) };
}
