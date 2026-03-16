import pc from "picocolors";
import type { OrchestratorResult } from "../runner/orchestrator.js";
import type { EvalCase } from "../schemas/evals.js";
import { getTurns } from "../schemas/evals.js";
import { rateColor } from "../utils/rate.js";

const LABEL_TRUNCATE = 100;
const EVIDENCE_TRUNCATE = 200;

export function printResults(result: OrchestratorResult, evals: EvalCase[], providerCount: number) {
	console.log(pc.bold("\n  Results\n"));
	const byEval = new Map<number, typeof result.runs>();
	for (const run of result.runs) {
		if (!byEval.has(run.eval_id)) byEval.set(run.eval_id, []);
		byEval.get(run.eval_id)?.push(run);
	}

	let totalPassed = 0;
	let totalFailed = 0;

	for (const [evalId, runs] of byEval) {
		const evalCase = evals.find((e) => e.id === evalId);
		const turns = evalCase ? getTurns(evalCase) : [];
		const label = (turns[0] ?? "").slice(0, LABEL_TRUNCATE);
		console.log(
			`  ${pc.bold(`Eval ${evalId}`)} ${pc.dim("—")} ${label}${label.length >= LABEL_TRUNCATE ? "..." : ""}`,
		);

		for (const run of runs) {
			const r = run.result;
			totalPassed += r.passed;
			totalFailed += r.failed;

			const providerLabel = providerCount > 1 ? `${pc.dim("[")}${run.model}${pc.dim("]")} ` : "";

			for (const exp of run.expectations) {
				if (exp.passed) {
					console.log(`    ${pc.green("✓")} ${providerLabel}${exp.text}`);
				} else {
					console.log(`    ${pc.red("✗")} ${providerLabel}${exp.text}`);
					if (exp.evidence) {
						console.log(`      ${pc.dim(exp.evidence.slice(0, EVIDENCE_TRUNCATE))}`);
					}
				}
			}

			if (run.eval_feedback) {
				console.log(`    ${pc.dim(`› ${run.eval_feedback}`)}`);
			}

			if (providerCount > 1) {
				console.log(
					`    ${pc.dim(`${r.passed}/${r.total} passed · ${r.time_seconds.toFixed(1)}s`)}`,
				);
			}
		}
		console.log("");
	}

	const totalAssertions = totalPassed + totalFailed;
	const overallRate = totalAssertions > 0 ? totalPassed / totalAssertions : 0;
	const scoreColor = rateColor(overallRate);

	console.log(pc.bold("  Scorecard\n"));
	console.log(
		`  ${scoreColor(pc.bold(`${(overallRate * 100).toFixed(0)}%`))} overall  ${pc.dim(`(${totalPassed} passed, ${totalFailed} failed out of ${totalAssertions} assertions)`)}`,
	);

	for (const [key, stats] of Object.entries(result.providerSummary)) {
		const color = rateColor(stats.pass_rate.mean);
		console.log(
			`  ${color(pc.bold(`${(stats.pass_rate.mean * 100).toFixed(0)}%`))} ${key}` +
				`  ${pc.dim(`${stats.time_seconds.mean.toFixed(1)}s avg · ${stats.total_tokens.mean.toFixed(0)} tok · $${stats.cost_usd.mean.toFixed(4)}`)}`,
		);
	}
	console.log("");
}
