import fs from "node:fs";
import pc from "picocolors";
import type { BenchmarkFile, ProviderSummary } from "../schemas/benchmark.js";
import { BenchmarkFileSchema } from "../schemas/benchmark.js";
import { exitWithMissingFile } from "../utils/cli-error.js";
import { rateColor } from "../utils/rate.js";

export interface CompareResult {
	provider: string;
	goldenRate: number;
	currentRate: number;
	delta: number;
	regressed: boolean;
}

function formatSkillBuild(metadata?: BenchmarkFile["metadata"]): string | null {
	if (!metadata) return null;
	const parts: string[] = [];
	if (metadata.skill_version) parts.push(metadata.skill_version);
	if (metadata.skill_sha256) parts.push(metadata.skill_sha256.slice(0, 8));
	if (parts.length === 0) return null;
	return parts.join(" · ");
}

/** Pure comparison — no I/O. */
export function compareBenchmarks(
	golden: ProviderSummary,
	current: ProviderSummary,
): CompareResult[] {
	return Object.entries(golden).map(([provider, stats]) => {
		const goldenRate = stats.pass_rate.mean;
		const currentRate = current[provider]?.pass_rate.mean ?? 0;
		const delta = currentRate - goldenRate;
		return { provider, goldenRate, currentRate, delta, regressed: delta < 0 };
	});
}

/** Print a comparison table. Returns `true` if any provider regressed. */
export function printComparison(
	results: CompareResult[],
	goldenPath: string,
	metadata?: {
		goldenMetadata?: BenchmarkFile["metadata"];
		currentMetadata?: BenchmarkFile["metadata"];
	},
): boolean {
	console.log(pc.bold(`\n  Regression check ${pc.dim(`(vs ${goldenPath})`)}\n`));
	const goldenBuild = formatSkillBuild(metadata?.goldenMetadata);
	const currentBuild = formatSkillBuild(metadata?.currentMetadata);
	if (goldenBuild || currentBuild) {
		const goldenName = metadata?.goldenMetadata?.skill_name ?? "golden";
		const currentName = metadata?.currentMetadata?.skill_name ?? "current";
		if (goldenBuild) {
			console.log(`  Golden:    ${goldenName} ${pc.dim(`(${goldenBuild})`)}`);
		}
		if (currentBuild) {
			console.log(`  Current:   ${currentName} ${pc.dim(`(${currentBuild})`)}`);
		}
		console.log("");
	}

	for (const r of results) {
		const icon = r.regressed ? pc.red("✗") : pc.green("✓");
		const color = rateColor(r.currentRate);
		const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
		const sign = r.delta >= 0 ? "+" : "";
		console.log(
			`  ${icon} ${r.provider.padEnd(28)} ${pct(r.goldenRate)} → ${color(pct(r.currentRate))}  (${sign}${pct(r.delta)})`,
		);
	}

	const regressed = results.filter((r) => r.regressed);
	if (regressed.length > 0) {
		console.log(`\n  ${pc.red(pc.bold(`FAIL: ${regressed.length} provider(s) regressed`))}\n`);
		return true;
	}

	console.log(`\n  ${pc.green(pc.bold("PASS: no regressions"))}\n`);
	return false;
}

function loadBenchmark(filePath: string) {
	const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
	return BenchmarkFileSchema.parse(raw);
}

export function runCompare(goldenPath: string, currentPath: string) {
	if (!fs.existsSync(goldenPath)) {
		exitWithMissingFile(
			"Golden benchmark",
			goldenPath,
			`Pass the path to a JSON result file from ${pc.bold(".skillet-evals/results/<skill>/")}.`,
		);
	}
	if (!fs.existsSync(currentPath)) {
		exitWithMissingFile(
			"Current benchmark",
			currentPath,
			`Pass the path to a JSON result file from ${pc.bold(".skillet-evals/results/<skill>/")}.`,
		);
	}
	const golden = loadBenchmark(goldenPath);
	const current = loadBenchmark(currentPath);
	const results = compareBenchmarks(golden.provider_summary, current.provider_summary);
	const failed = printComparison(results, goldenPath, {
		goldenMetadata: golden.metadata,
		currentMetadata: current.metadata,
	});
	if (failed) process.exit(1);
}
