import { Chart, registerables } from "chart.js";
import "./styles.css";
import type { BenchmarkFile, EvalContext, RunSummary, SkillSummary } from "./types";

Chart.register(...registerables);

const HIGH_THRESHOLD = 0.8;
const MID_THRESHOLD = 0.5;
const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) {
	throw new Error("Missing #app mount point");
}
const app = appElement;

let activeChart: Chart | null = null;

void renderApp();

async function renderApp() {
	renderLoading();

	try {
		const [context, skills] = await Promise.all([
			getJson<EvalContext>("/api/context"),
			getJson<SkillSummary[]>("/api/skills"),
		]);
		const route = parseRoute(window.location.pathname);

		if (route.kind === "home" && context.mode === "single" && context.skillId) {
			await renderSkillPage(context, context.skillId);
			return;
		}

		if (route.kind === "home") {
			renderHomePage(context, skills);
			return;
		}

		if (route.kind === "skill") {
			await renderSkillPage(context, route.skillId);
			return;
		}

		if (route.kind === "run") {
			await renderRunPage(context, route.skillId, route.runFile);
			return;
		}

		renderNotFound("Page not found.");
	} catch (error) {
		renderError(error instanceof Error ? error.message : "Failed to load eval results.");
	}
}

function parseRoute(pathname: string) {
	const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
	if (parts.length === 0) return { kind: "home" as const };
	if (parts.length === 2 && parts[0] === "skills") {
		return { kind: "skill" as const, skillId: parts[1] };
	}
	if (parts.length === 4 && parts[0] === "skills" && parts[2] === "runs") {
		return { kind: "run" as const, skillId: parts[1], runFile: parts[3] };
	}
	return { kind: "not-found" as const };
}

async function renderSkillPage(context: EvalContext, skillId: string) {
	const runs = await getJson<RunSummary[]>(`/api/skills/${encodePath(skillId)}/runs`);
	if (runs.length === 0) {
		renderNotFound("No runs found for that skill.");
		return;
	}

	const latest = runs[0];
	const skillName = latest.metadata.skill_name || skillId;
	const latestPassRate = latest.passRate;
	const chartData = runs
		.slice()
		.reverse()
		.map((run) => ({
			label: formatDateShort(run.metadata.timestamp),
			value: run.passRate * 100,
		}));

	app.innerHTML = pageShell({
		title: "skillet eval",
		subtitle: `${escapeHtml(skillName)} — ${runs.length} run(s)`,
		backLinks: [
			...(context.mode === "all"
				? [{ href: "/", label: "All skills", tone: "secondary" as const }]
				: []),
		],
		body: `
			${statsGrid([
				statCard("Latest pass rate", pct(latestPassRate), passTextClass(latestPassRate)),
				statCard("Visible runs", String(runs.length)),
				statCard("Provider(s) tested", String(Object.keys(latest.providerSummary ?? {}).length)),
			])}

			<section class="mt-12">
				<h2 class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Pass Rate Over Time</h2>
				<div class="border border-zinc-800 bg-zinc-950 p-4">
					<canvas id="skill-chart"></canvas>
				</div>
			</section>

			<section class="mt-12">
				<h2 class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Run History</h2>
				<div class="overflow-x-auto border border-zinc-800 bg-zinc-950">
					<table class="min-w-full border-collapse text-sm">
						<thead class="border-b border-zinc-800 bg-zinc-900 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							<tr>
								<th class="px-4 py-3 font-medium">Run</th>
								<th class="px-4 py-3 font-medium">Score</th>
								<th class="px-4 py-3 font-medium">Providers</th>
								<th class="px-4 py-3 font-medium text-right">View</th>
							</tr>
						</thead>
						<tbody>
							${runs.map((run) => skillRunRow(skillId, run)).join("")}
						</tbody>
					</table>
				</div>
			</section>
		`,
	});

	renderLineChart(
		"skill-chart",
		chartData.map((entry) => entry.label),
		chartData.map((entry) => entry.value),
	);
}

async function renderRunPage(context: EvalContext, skillId: string, runFile: string) {
	const benchmark = await getJson<BenchmarkFile>(
		`/api/results/${encodePath(skillId)}/${encodePath(runFile)}`,
	);
	const grouped = groupRunsByEval(benchmark);
	const providerEntries = Object.entries(benchmark.provider_summary ?? {});

	app.innerHTML = pageShell({
		title: "Run Details",
		subtitle: `${escapeHtml(benchmark.metadata.skill_name)} — ${escapeHtml(formatBuildLabel(benchmark.metadata))} — ${escapeHtml(formatDateTime(benchmark.metadata.timestamp))}`,
		backLinks: [
			{ href: skillHref(skillId), label: "Back to skill", tone: "primary" as const },
			...(context.mode === "all"
				? [{ href: "/", label: "All skills", tone: "secondary" as const }]
				: []),
		],
		body: `
			<section class="mt-12">
				<h2 class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Provider Comparison</h2>
				<div class="overflow-x-auto border border-zinc-800 bg-zinc-950">
					<table class="min-w-full border-collapse text-sm">
						<thead class="border-b border-zinc-800 bg-zinc-900 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							<tr>
								<th class="px-4 py-3 font-medium">Model</th>
								<th class="px-4 py-3 font-medium">Pass Rate</th>
								<th class="px-4 py-3 font-medium">Avg Time</th>
								<th class="px-4 py-3 font-medium">Avg Tokens</th>
								<th class="px-4 py-3 font-medium">Avg Cost</th>
							</tr>
						</thead>
						<tbody>
							${providerEntries
								.map(
									([model, stats]) => `
								<tr class="border-b border-zinc-900">
									<td class="px-4 py-3 font-medium text-zinc-100">${escapeHtml(model)}</td>
									<td class="px-4 py-3 ${passTextClass(stats.pass_rate.mean)}">${pct(stats.pass_rate.mean)} <span class="text-zinc-500">±${pct(stats.pass_rate.stddev)}</span></td>
									<td class="px-4 py-3 text-zinc-300">${fmt(stats.time_seconds.mean, 1)}s <span class="text-zinc-500">±${fmt(stats.time_seconds.stddev, 1)}s</span></td>
									<td class="px-4 py-3 text-zinc-300">${fmt(stats.total_tokens.mean, 0)} <span class="text-zinc-500">±${fmt(stats.total_tokens.stddev, 0)}</span></td>
									<td class="px-4 py-3 text-zinc-300">$${fmt(stats.cost_usd.mean, 4)} <span class="text-zinc-500">±$${fmt(stats.cost_usd.stddev, 4)}</span></td>
								</tr>
							`,
								)
								.join("")}
						</tbody>
					</table>
				</div>
			</section>

			<section class="mt-12">
				<h2 class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Pass Rate by Model</h2>
				<div class="border border-zinc-800 bg-zinc-950 p-4">
					<canvas id="run-chart"></canvas>
				</div>
			</section>

			<section class="mt-12">
				<h2 class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Eval Details</h2>
				<div class="space-y-4">
					${grouped.map(([evalId, runs]) => evalGroup(evalId, runs)).join("")}
				</div>
			</section>
		`,
	});

	renderBarChart(
		"run-chart",
		providerEntries.map(([model]) => model),
		providerEntries.map(([, stats]) => stats.pass_rate.mean * 100),
	);
}

function renderHomePage(context: EvalContext, skills: SkillSummary[]) {
	const distinctProviderCount = new Set(
		skills.map((skill) => skill.latestProviderCount).filter(Boolean),
	).size;
	const avgLatestPassRate =
		skills.length > 0
			? skills.reduce((sum, skill) => sum + skill.latestPassRate, 0) / skills.length
			: 0;

	app.innerHTML = pageShell({
		title: "skillet eval",
		subtitle:
			skills.length === 0
				? "No results yet"
				: `${skills.length} skill${skills.length === 1 ? "" : "s"} available`,
		backLinks: [],
		body:
			skills.length === 0
				? emptyState("Run `skillet eval run` to generate results.")
				: `
					${
						context.mode === "single" && context.skillName
							? `
						<div class="border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
							Serving a single skill: <span class="text-white">${escapeHtml(context.skillName)}</span>
						</div>
					`
							: ""
					}
					${statsGrid([
						statCard(
							"Latest avg pass rate",
							pct(avgLatestPassRate),
							passTextClass(avgLatestPassRate),
						),
						statCard("Skills", String(skills.length)),
						statCard("Distinct provider counts", String(distinctProviderCount)),
					])}
					<section class="mt-12">
						<h2 class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Skills</h2>
						<div class="overflow-x-auto border border-zinc-800 bg-zinc-950">
							<table class="min-w-full border-collapse text-sm">
								<thead class="border-b border-zinc-800 bg-zinc-900 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
									<tr>
										<th class="px-4 py-3 font-medium">Skill</th>
										<th class="px-4 py-3 font-medium">Latest score</th>
										<th class="px-4 py-3 font-medium">Runs</th>
										<th class="px-4 py-3 font-medium">Latest run</th>
										<th class="px-4 py-3 font-medium text-right">Open</th>
									</tr>
								</thead>
								<tbody>
									${skills.map((skill) => homeSkillRow(skill)).join("")}
								</tbody>
							</table>
						</div>
					</section>
				`,
	});
}

function pageShell({
	title,
	subtitle,
	backLinks,
	body,
}: {
	title: string;
	subtitle: string;
	backLinks: Array<{ href: string; label: string; tone: "primary" | "secondary" }>;
	body: string;
}) {
	return `
		<div class="min-h-screen bg-black text-zinc-100">
			<div class="mx-auto max-w-7xl px-6 py-8 sm:px-8 lg:px-12">
				<div class="mb-8 flex flex-wrap items-center gap-3">
					${backLinks.map((link) => navLink(link.href, link.label, link.tone)).join("")}
				</div>
				<header class="border-b border-zinc-800 pb-6">
					<h1 class="text-3xl font-semibold tracking-tight text-white">${escapeHtml(title)}</h1>
					<p class="mt-2 text-sm text-zinc-500">${subtitle}</p>
				</header>
				${body}
			</div>
		</div>
	`;
}

function statsGrid(cards: string[]) {
	return `<section class="mt-10 grid gap-4 md:grid-cols-3">${cards.join("")}</section>`;
}

function statCard(label: string, value: string, valueClass = "text-white") {
	return `
		<div class="border border-zinc-800 bg-zinc-950 p-5">
			<div class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">${escapeHtml(label)}</div>
			<div class="mt-3 text-4xl font-semibold ${valueClass}">${escapeHtml(value)}</div>
		</div>
	`;
}

function homeSkillRow(skill: SkillSummary) {
	return `
		<tr class="border-b border-zinc-900">
			<td class="px-4 py-4">
				<div class="font-medium text-white">${escapeHtml(skill.name)}</div>
				<div class="mt-1 font-mono text-xs text-zinc-500">${escapeHtml(skill.id)}</div>
			</td>
			<td class="px-4 py-4 ${passTextClass(skill.latestPassRate)}">${pct(skill.latestPassRate)}</td>
			<td class="px-4 py-4 text-zinc-300">${skill.runCount}</td>
			<td class="px-4 py-4 text-zinc-400">${skill.latestTimestamp ? escapeHtml(formatDateTime(skill.latestTimestamp)) : "Unknown"}</td>
			<td class="px-4 py-4 text-right">
				<a class="${linkClass("primary")}" href="${skillHref(skill.id)}">Open skill</a>
			</td>
		</tr>
	`;
}

function skillRunRow(skillId: string, run: RunSummary) {
	const providerLines = Object.entries(run.providerSummary ?? {})
		.map(
			([provider, summary]) => `
			<div class="text-xs">
				<span class="${passTextClass(summary.pass_rate.mean)}">${pct(summary.pass_rate.mean)}</span>
				<span class="ml-2 text-zinc-500">${escapeHtml(provider)}</span>
			</div>
		`,
		)
		.join("");

	return `
		<tr class="border-b border-zinc-900">
			<td class="px-4 py-4">
				<div class="font-medium text-white">${escapeHtml(formatDateTime(run.metadata.timestamp))}</div>
				<div class="mt-1 font-mono text-xs text-zinc-500">${escapeHtml(formatBuildLabel(run.metadata))} · ${escapeHtml(run.file)}</div>
			</td>
			<td class="px-4 py-4 ${passTextClass(run.passRate)}">
				<div class="text-lg font-semibold">${pct(run.passRate)}</div>
				<div class="text-xs text-zinc-500">${run.totalPassed}/${run.totalAssertions}</div>
			</td>
			<td class="px-4 py-4">${providerLines}</td>
			<td class="px-4 py-4 text-right">
				<div class="flex justify-end gap-2">
					<a class="${linkClass("primary")}" href="${runHref(skillId, run.file)}">Details</a>
					<a class="${linkClass("secondary")}" href="/api/results/${encodePath(skillId)}/${encodePath(run.file)}">JSON</a>
				</div>
			</td>
		</tr>
	`;
}

function evalGroup(evalId: number, runs: BenchmarkFile["runs"]) {
	return `
		<details class="border border-zinc-800 bg-zinc-950">
			<summary class="cursor-pointer border-b border-zinc-800 px-4 py-3 text-sm font-medium text-white">
				Eval ${evalId} — ${runs.length} run(s)
			</summary>
			<div class="space-y-4 p-4">
				${runs.map((run) => evalRunCard(run)).join("")}
			</div>
		</details>
	`;
}

function evalRunCard(run: BenchmarkFile["runs"][number]) {
	return `
		<article class="border border-zinc-800 bg-black p-4">
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
				<h3 class="text-sm font-medium text-white">${escapeHtml(run.model)} (run ${run.run_number})</h3>
				${run.error ? '<span class="text-xs uppercase tracking-[0.16em] text-red-400">Error</span>' : ""}
			</div>
			<div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-400">
				<span class="${passTextClass(run.result.pass_rate)}">${pct(run.result.pass_rate)} pass rate</span>
				<span>${fmt(run.result.time_seconds, 1)}s</span>
				<span>${run.result.total_tokens ?? 0} tokens</span>
				<span>$${fmt(run.result.cost_usd, 4)}</span>
			</div>
			${run.error ? `<div class="mt-4 border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">${escapeHtml(run.error)}</div>` : ""}
			<div class="mt-4 space-y-2">
				${(run.expectations ?? [])
					.map(
						(expectation) => `
					<div class="border ${expectation.passed ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"} p-3">
						<div class="text-sm font-medium ${expectation.passed ? "text-green-400" : "text-red-400"}">
							${expectation.passed ? "Pass" : "Fail"}
						</div>
						<div class="mt-1 text-sm text-white">${escapeHtml(expectation.text)}</div>
						<div class="mt-2 text-xs text-zinc-500">${escapeHtml(expectation.evidence)}</div>
					</div>
				`,
					)
					.join("")}
			</div>
			${run.eval_feedback ? `<div class="mt-4 border-t border-zinc-800 pt-4 text-sm text-zinc-400"><span class="text-zinc-200">Feedback:</span> ${escapeHtml(run.eval_feedback)}</div>` : ""}
		</article>
	`;
}

function renderLineChart(elementId: string, labels: string[], values: number[]) {
	destroyChart();
	const canvas = document.getElementById(elementId) as HTMLCanvasElement | null;
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	activeChart = new Chart(ctx, {
		type: "line",
		data: {
			labels,
			datasets: [
				{
					label: "Pass Rate (%)",
					data: values,
					borderColor: "#ffffff",
					backgroundColor: "rgba(255,255,255,0.08)",
					fill: true,
					tension: 0.25,
					pointRadius: 3,
					pointBackgroundColor: "#ffffff",
				},
			],
		},
		options: chartOptions(),
	});
}

function renderBarChart(elementId: string, labels: string[], values: number[]) {
	destroyChart();
	const canvas = document.getElementById(elementId) as HTMLCanvasElement | null;
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	activeChart = new Chart(ctx, {
		type: "bar",
		data: {
			labels,
			datasets: [
				{
					label: "Pass Rate (%)",
					data: values,
					backgroundColor: values.map((value) => passChartColor(value / 100)),
					borderWidth: 0,
				},
			],
		},
		options: chartOptions(),
	});
}

function chartOptions() {
	return {
		responsive: true,
		plugins: {
			legend: { display: false },
		},
		scales: {
			x: {
				ticks: { color: "#a1a1aa" },
				grid: { color: "rgba(255,255,255,0.06)" },
			},
			y: {
				beginAtZero: true,
				max: 100,
				ticks: {
					color: "#a1a1aa",
					callback: (value: string | number) => `${value}%`,
				},
				grid: { color: "rgba(255,255,255,0.06)" },
			},
		},
	};
}

function destroyChart() {
	activeChart?.destroy();
	activeChart = null;
}

function renderLoading() {
	destroyChart();
	app.innerHTML = `
		<div class="flex min-h-screen items-center justify-center bg-black px-6 text-sm text-zinc-500">
			Loading eval results…
		</div>
	`;
}

function renderError(message: string) {
	destroyChart();
	app.innerHTML = `
		<div class="flex min-h-screen items-center justify-center bg-black px-6">
			<div class="max-w-xl border border-red-500/40 bg-red-500/10 p-5 text-sm text-red-300">
				${escapeHtml(message)}
			</div>
		</div>
	`;
}

function renderNotFound(message: string) {
	destroyChart();
	app.innerHTML = pageShell({
		title: "Not Found",
		subtitle: message,
		backLinks: [{ href: "/", label: "Back home", tone: "primary" }],
		body: emptyState("The requested eval page does not exist."),
	});
}

function emptyState(message: string) {
	return `
		<div class="mt-10 border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
			${escapeHtml(message)}
		</div>
	`;
}

function navLink(href: string, label: string, tone: "primary" | "secondary") {
	return `<a class="${linkClass(tone)}" href="${href}">${escapeHtml(label)}</a>`;
}

function linkClass(tone: "primary" | "secondary") {
	return tone === "primary"
		? "inline-flex items-center border border-white px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-white hover:bg-white hover:text-black"
		: "inline-flex items-center border border-zinc-700 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-300 hover:border-white hover:text-white";
}

function passTextClass(rate: number) {
	if (rate >= HIGH_THRESHOLD) return "text-green-400";
	if (rate >= MID_THRESHOLD) return "text-yellow-400";
	return "text-red-400";
}

function passChartColor(rate: number) {
	if (rate >= HIGH_THRESHOLD) return "rgba(74, 222, 128, 0.72)";
	if (rate >= MID_THRESHOLD) return "rgba(250, 204, 21, 0.72)";
	return "rgba(248, 113, 113, 0.72)";
}

function formatBuildLabel(metadata: BenchmarkFile["metadata"]) {
	const parts: string[] = [];
	if (metadata.skill_version) parts.push(metadata.skill_version);
	if (metadata.skill_sha256) parts.push(metadata.skill_sha256.slice(0, 8));
	return parts.length > 0 ? parts.join(" · ") : "version unknown";
}

function formatDateTime(value: string) {
	return new Date(value).toLocaleString();
}

function formatDateShort(value: string) {
	return new Date(value).toLocaleDateString();
}

function pct(value: number) {
	return `${(value * 100).toFixed(1)}%`;
}

function fmt(value: number, decimals = 2) {
	return Number(value).toFixed(decimals);
}

function skillHref(skillId: string) {
	return `/skills/${encodePath(skillId)}`;
}

function runHref(skillId: string, runFile: string) {
	return `/skills/${encodePath(skillId)}/runs/${encodePath(runFile)}`;
}

function encodePath(value: string) {
	return encodeURIComponent(value);
}

function escapeHtml(value: string) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Request failed: ${response.status} ${response.statusText}`);
	}
	return (await response.json()) as T;
}

function groupRunsByEval(benchmark: BenchmarkFile) {
	const groups = new Map<number, BenchmarkFile["runs"]>();
	for (const run of benchmark.runs ?? []) {
		const existing = groups.get(run.eval_id) ?? [];
		existing.push(run);
		groups.set(run.eval_id, existing);
	}
	return [...groups.entries()];
}
