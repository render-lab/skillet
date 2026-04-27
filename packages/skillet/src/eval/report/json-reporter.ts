import fs from "node:fs";
import type { ResolvedConfig } from "../config/schema.js";
import type { OrchestratorResult } from "../runner/orchestrator.js";
import type { BenchmarkFile } from "../schemas/benchmark.js";

export function writeBenchmarkJson(
	result: OrchestratorResult,
	config: ResolvedConfig,
	meta: {
		skillName: string;
		skillPath: string;
		evalsRun: number[];
	},
	outputPath: string,
) {
	const benchmark: BenchmarkFile = {
		metadata: {
			skill_name: meta.skillName,
			skill_path: meta.skillPath,
			timestamp: new Date().toISOString(),
			evals_run: meta.evalsRun,
			runs_per_provider: config.settings.runsPerProvider,
			providers: config.providers.map((p) => ({ name: p.name, model: p.model })),
			grader: { name: config.grader.provider, model: config.grader.model },
		},
		runs: result.runs,
		provider_summary: result.providerSummary,
		notes: [],
	};

	fs.writeFileSync(outputPath, `${JSON.stringify(benchmark, null, 2)}\n`);
	return outputPath;
}
