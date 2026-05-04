import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { findProjectRoot, resolveSkillPaths } from "../config.js";
import type { BenchmarkFile, BenchmarkRun } from "../schemas/benchmark.js";

interface ReportOpts {
	skill: string;
	evals?: string;
	output?: string;
}

interface ReportRun {
	skillId: string;
	file: string;
	benchmark: BenchmarkFile;
}

function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function pct(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function passRate(runs: BenchmarkRun[]): number {
	const passed = runs.reduce((sum, run) => sum + (run.result?.passed ?? 0), 0);
	const total = runs.reduce((sum, run) => sum + (run.result?.total ?? 0), 0);
	return total > 0 ? passed / total : 0;
}

function scoreClass(value: number): string {
	if (value >= 0.8) return "good";
	if (value >= 0.5) return "warn";
	return "bad";
}

function resolvePathUnder(baseDir: string, ...parts: string[]) {
	const resolved = path.resolve(baseDir, ...parts);
	return resolved.startsWith(path.resolve(baseDir)) ? resolved : null;
}

function listResultFiles(resultsRoot: string): ReportRun[] {
	if (!fs.existsSync(resultsRoot)) return [];
	const runs: ReportRun[] = [];
	for (const skillEntry of fs.readdirSync(resultsRoot, { withFileTypes: true })) {
		if (!skillEntry.isDirectory()) continue;
		const skillId = skillEntry.name;
		const skillDir = path.join(resultsRoot, skillId);
		for (const file of fs.readdirSync(skillDir)) {
			if (!file.endsWith(".json") || file === "latest.json") continue;
			const filePath = resolvePathUnder(skillDir, file);
			if (!filePath) continue;
			try {
				runs.push({
					skillId,
					file,
					benchmark: JSON.parse(fs.readFileSync(filePath, "utf-8")) as BenchmarkFile,
				});
			} catch {
				// Ignore corrupt result files so one bad run does not break the whole report.
			}
		}
	}
	return runs.sort((a, b) =>
		(b.benchmark.metadata.timestamp ?? "").localeCompare(a.benchmark.metadata.timestamp ?? ""),
	);
}

function latestBySkill(runs: ReportRun[]): ReportRun[] {
	const bySkill = new Map<string, ReportRun>();
	for (const run of runs) {
		if (!bySkill.has(run.skillId)) bySkill.set(run.skillId, run);
	}
	return Array.from(bySkill.values()).sort((a, b) => a.skillId.localeCompare(b.skillId));
}

function renderRunRows(run: ReportRun): string {
	return run.benchmark.runs
		.map((benchmarkRun) => {
			const rate = benchmarkRun.result?.pass_rate ?? 0;
			return `<tr>
				<td>${escapeHtml(benchmarkRun.eval_id)}</td>
				<td>${escapeHtml(benchmarkRun.model)}</td>
				<td class="${scoreClass(rate)}">${pct(rate)}</td>
				<td>${escapeHtml(`${benchmarkRun.result?.passed ?? 0}/${benchmarkRun.result?.total ?? 0}`)}</td>
				<td>${escapeHtml((benchmarkRun.result?.time_seconds ?? 0).toFixed(1))}s</td>
				<td>${escapeHtml(benchmarkRun.error ?? "")}</td>
			</tr>`;
		})
		.join("");
}

function renderReport(runs: ReportRun[]): string {
	const latestRuns = latestBySkill(runs);
	const allBenchmarkRuns = latestRuns.flatMap((run) => run.benchmark.runs);
	const overallRate = passRate(allBenchmarkRuns);
	const totalPassed = allBenchmarkRuns.reduce((sum, run) => sum + (run.result?.passed ?? 0), 0);
	const totalAssertions = allBenchmarkRuns.reduce((sum, run) => sum + (run.result?.total ?? 0), 0);
	const generatedAt = new Date().toISOString();

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Skillet Eval Report</title>
	<style>
		:root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #050505; color: #e5e5e5; }
		body { margin: 0; padding: 32px; }
		a { color: inherit; }
		.header { border-bottom: 1px solid #333; padding-bottom: 24px; margin-bottom: 32px; }
		.kicker { color: #a1a1aa; text-transform: uppercase; letter-spacing: .2em; font-size: 12px; }
		h1 { font-size: 44px; margin: 8px 0; }
		h2 { margin-top: 40px; font-size: 18px; text-transform: uppercase; letter-spacing: .16em; color: #a1a1aa; }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
		.card { border: 1px solid #333; background: #09090b; padding: 16px; }
		.value { font-size: 28px; font-weight: 700; }
		.label { color: #a1a1aa; font-size: 12px; margin-top: 4px; }
		table { width: 100%; border-collapse: collapse; border: 1px solid #333; background: #09090b; }
		th, td { border-bottom: 1px solid #27272a; padding: 10px 12px; text-align: left; vertical-align: top; }
		th { color: #a1a1aa; font-size: 11px; text-transform: uppercase; letter-spacing: .14em; }
		details { border: 1px solid #333; background: #09090b; margin: 12px 0; padding: 12px; }
		summary { cursor: pointer; font-weight: 700; }
		.good { color: #22c55e; }
		.warn { color: #eab308; }
		.bad { color: #ef4444; }
		.muted { color: #a1a1aa; }
	</style>
</head>
<body>
	<header class="header">
		<div class="kicker">Skillet eval</div>
		<h1>Static Report</h1>
		<div class="muted">Generated ${escapeHtml(generatedAt)}</div>
	</header>

	<section class="grid">
		<div class="card"><div class="value ${scoreClass(overallRate)}">${pct(overallRate)}</div><div class="label">Overall pass rate</div></div>
		<div class="card"><div class="value">${escapeHtml(`${totalPassed}/${totalAssertions}`)}</div><div class="label">Assertions passed</div></div>
		<div class="card"><div class="value">${latestRuns.length}</div><div class="label">Skills with results</div></div>
		<div class="card"><div class="value">${allBenchmarkRuns.length}</div><div class="label">Runs in latest results</div></div>
	</section>

	<h2>Skills</h2>
	<table>
		<thead><tr><th>Skill</th><th>Latest run</th><th>Score</th><th>Assertions</th><th>Providers</th></tr></thead>
		<tbody>
			${latestRuns
				.map((run) => {
					const rate = passRate(run.benchmark.runs);
					const passed = run.benchmark.runs.reduce(
						(sum, item) => sum + (item.result?.passed ?? 0),
						0,
					);
					const total = run.benchmark.runs.reduce(
						(sum, item) => sum + (item.result?.total ?? 0),
						0,
					);
					return `<tr>
						<td>${escapeHtml(run.benchmark.metadata.skill_name ?? run.skillId)}</td>
						<td>${escapeHtml(run.file)}</td>
						<td class="${scoreClass(rate)}">${pct(rate)}</td>
						<td>${escapeHtml(`${passed}/${total}`)}</td>
						<td>${escapeHtml(Object.keys(run.benchmark.provider_summary ?? {}).join(", "))}</td>
					</tr>`;
				})
				.join("")}
		</tbody>
	</table>

	<h2>Run Details</h2>
	${latestRuns
		.map(
			(run) => `<details>
				<summary>${escapeHtml(run.benchmark.metadata.skill_name ?? run.skillId)} — ${escapeHtml(run.file)}</summary>
				<table>
					<thead><tr><th>Eval</th><th>Model</th><th>Score</th><th>Assertions</th><th>Time</th><th>Error</th></tr></thead>
					<tbody>${renderRunRows(run)}</tbody>
				</table>
			</details>`,
		)
		.join("")}
</body>
</html>`;
}

export function runReport(opts: ReportOpts) {
	const paths = resolveSkillPaths(opts.skill, opts.evals);
	const projectRoot = findProjectRoot(paths.skillDir);
	const resultsRoot = path.join(projectRoot, ".skillet-evals", "results");
	const outputDir = path.resolve(opts.output ?? path.join(projectRoot, ".skillet-evals", "report"));
	const outputPath = path.join(outputDir, "index.html");

	fs.mkdirSync(outputDir, { recursive: true });
	const html = renderReport(listResultFiles(resultsRoot));
	fs.writeFileSync(outputPath, html);

	console.log(pc.green(`Wrote ${outputPath}`));
}
