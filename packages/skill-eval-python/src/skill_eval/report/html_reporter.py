from __future__ import annotations

from pathlib import Path

from skill_eval.utils.rate import HIGH_THRESHOLD, MID_THRESHOLD


def _get_template() -> str:
    this_dir = Path(__file__).resolve().parent
    workspace = this_dir.parents[4]
    ts_path = workspace / "ts" / "src" / "report" / "html-reporter.ts"
    if ts_path.exists():
        import re
        content = ts_path.read_text()
        m = re.search(r"const DASHBOARD_TEMPLATE = /\* html \*/ \`([\s\S]*?)\`;", content)
        if m:
            return m.group(1)
    return DASHBOARD_TEMPLATE_FALLBACK


def write_dashboard(results_dir: str) -> str:
    output_path = Path(results_dir) / "index.html"
    template = _get_template()
    html = template.replace("__HIGH_THRESHOLD__", str(HIGH_THRESHOLD)).replace(
        "__MID_THRESHOLD__", str(MID_THRESHOLD)
    )
    output_path.write_text(html, encoding="utf-8")
    return str(output_path)


DASHBOARD_TEMPLATE_FALLBACK = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>skill-eval dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
:root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --green: #22c55e; --yellow: #eab308; --red: #ef4444; --accent: #3b82f6; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
.subtitle { color: var(--muted); margin-bottom: 2rem; }
h2 { font-size: 1.25rem; margin: 2rem 0 1rem; }

/* Top stats */
.top-stats { display: flex; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
.stat-card { background: var(--surface); border-radius: 8px; padding: 1.25rem 1.5rem; flex: 1; min-width: 160px; }
.stat-value { font-size: 2rem; font-weight: 700; }
.stat-label { color: var(--muted); font-size: 0.85rem; margin-top: 0.25rem; }

/* Tables */
table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 8px; overflow: hidden; }
th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
th { background: var(--border); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
.text-center { text-align: center; }
.text-green { color: var(--green); }
.text-yellow { color: var(--yellow); }
.text-red { color: var(--red); }
.muted { color: var(--muted); font-size: 0.85em; }
.font-medium { font-weight: 500; }

/* Run list */
.run-row { cursor: pointer; transition: background 0.15s; }
.run-row:hover { background: var(--border); }
.timestamp { font-weight: 500; }
.file-name { color: var(--muted); font-size: 0.8em; font-family: monospace; }
.rate-big { font-size: 1.3rem; font-weight: 700; }
.rate-detail { color: var(--muted); font-size: 0.8em; }
.provider-line { font-size: 0.85rem; margin-bottom: 0.15rem; }

/* Buttons */
.btn { display: inline-block; padding: 0.35rem 0.8rem; border-radius: 4px; background: var(--accent); color: white; text-decoration: none; font-size: 0.8rem; font-weight: 500; margin-right: 0.25rem; border: none; cursor: pointer; }
.btn-dim { background: var(--border); color: var(--muted); }
.btn:hover { opacity: 0.85; }
.btn-back { margin-bottom: 1.5rem; }

/* Details / run view */
details { background: var(--surface); border-radius: 8px; margin-bottom: 0.75rem; }
summary { cursor: pointer; padding: 1rem; font-weight: 500; }
summary:hover { background: var(--border); border-radius: 8px; }
.eval-detail { padding: 0 1rem 1rem; }
.run-card { background: var(--bg); border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; }
.run-card h4 { font-size: 0.95rem; margin-bottom: 0.5rem; }
.stats-row { display: flex; gap: 1.5rem; font-size: 0.9rem; margin-bottom: 0.75rem; color: var(--muted); flex-wrap: wrap; }
.stats-row span:first-child { font-weight: 500; }
.expectations { display: flex; flex-direction: column; gap: 0.5rem; }
.expectation { display: flex; gap: 0.75rem; padding: 0.5rem; border-radius: 4px; }
.expectation.pass { background: rgba(34,197,94,0.08); }
.expectation.fail { background: rgba(239,68,68,0.08); }
.indicator { font-size: 1.1rem; line-height: 1.4; }
.expectation.pass .indicator { color: var(--green); }
.expectation.fail .indicator { color: var(--red); }
.assertion-text { font-size: 0.9rem; font-weight: 500; }
.evidence { font-size: 0.8rem; color: var(--muted); margin-top: 0.25rem; }
.feedback { font-size: 0.85rem; color: var(--muted); margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border); }

canvas { max-height: 250px; margin-bottom: 1rem; }
.empty { text-align: center; padding: 3rem; color: var(--muted); }
.error-banner { background: rgba(239,68,68,0.15); color: var(--red); padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
.loading { text-align: center; padding: 3rem; color: var(--muted); }
</style>
</head>
<body>
<div class="container" id="app">
  <div class="loading">Loading results…</div>
</div>

<script>
const $ = (sel) => document.querySelector(sel);
const esc = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const pct = (n) => (n * 100).toFixed(1) + "%";
const fmt = (n, d=2) => Number(n).toFixed(d);
const HIGH_THRESHOLD = __HIGH_THRESHOLD__;
const MID_THRESHOLD = __MID_THRESHOLD__;
const rateClass = (r) => r >= HIGH_THRESHOLD ? "text-green" : r >= MID_THRESHOLD ? "text-yellow" : "text-red";

let runs = []; // sorted newest-first
let charts = [];

async function init() {
  try {
    const res = await fetch("/api/runs");
    const files = await res.json();
    runs = [];
    for (const file of files) {
      try {
        const data = await (await fetch("/" + file)).json();
        runs.push({ file, data });
      } catch {}
    }
    runs.sort((a, b) => (b.data.metadata?.timestamp ?? "").localeCompare(a.data.metadata?.timestamp ?? ""));
    renderList();
  } catch (e) {
    $("#app").innerHTML = '<div class="error-banner">Failed to load results. Make sure you\\\\'re using <code>skill-eval serve</code>.</div>';
  }
}

function renderList() {
  if (!runs.length) {
    $("#app").innerHTML = '<h1>skill-eval</h1><p class="subtitle">No results yet</p><div class="empty">Run <code>skill-eval run</code> to generate results.</div>';
    return;
  }

  const latest = runs[0].data;
  const skillName = latest.metadata?.skill_name ?? "Unknown";
  const latestSummary = latest.provider_summary ?? {};
  const latestPassRates = Object.values(latestSummary).map(s => s.pass_rate?.mean ?? 0);
  const avgLatest = latestPassRates.length ? latestPassRates.reduce((a, b) => a + b, 0) / latestPassRates.length : 0;

  const chartData = runs.slice().reverse().map(r => {
    const s = r.data.provider_summary ?? {};
    const rates = Object.values(s).map(x => x.pass_rate?.mean ?? 0);
    return {
      label: new Date(r.data.metadata?.timestamp).toLocaleDateString(),
      value: rates.length ? (rates.reduce((a,b) => a+b, 0) / rates.length * 100) : 0,
    };
  });

  let html = '<h1>skill-eval</h1>';
  html += '<p class="subtitle">' + esc(skillName) + ' — ' + runs.length + ' run(s)</p>';

  // Top stats
  html += '<div class="top-stats">';
  html += '<div class="stat-card"><div class="stat-value ' + rateClass(avgLatest) + '">' + pct(avgLatest) + '</div><div class="stat-label">Latest pass rate</div></div>';
  html += '<div class="stat-card"><div class="stat-value">' + runs.length + '</div><div class="stat-label">Total runs</div></div>';
  html += '<div class="stat-card"><div class="stat-value">' + Object.keys(latestSummary).length + '</div><div class="stat-label">Provider(s) tested</div></div>';
  html += '</div>';

  // Chart
  if (chartData.length > 1) {
    html += '<h2>Pass Rate Over Time</h2><canvas id="chart"></canvas>';
  }

  // Run table
  html += '<h2>Run History</h2><table><thead><tr><th>Run</th><th class="text-center">Score</th><th>Providers</th><th class="text-center">View</th></tr></thead><tbody>';

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i].data;
    const meta = r.metadata ?? {};
    const summary = r.provider_summary ?? {};
    const totalRuns = r.runs?.length ?? 0;
    const totalPassed = (r.runs ?? []).reduce((s, x) => s + (x.result?.passed ?? 0), 0);
    const totalAssertions = (r.runs ?? []).reduce((s, x) => s + (x.result?.total ?? 0), 0);
    const passRate = totalAssertions > 0 ? totalPassed / totalAssertions : 0;

    const providers = Object.entries(summary).map(([k, v]) =>
      '<div class="provider-line"><span class="' + rateClass(v.pass_rate?.mean ?? 0) + '">' + pct(v.pass_rate?.mean ?? 0) + '</span> <span class="muted">' + esc(k) + '</span></div>'
    ).join("");

    const ts = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : runs[i].file;

    html += '<tr class="run-row" onclick="showRun(' + i + ')">';
    html += '<td><div class="timestamp">' + esc(ts) + '</div><div class="file-name">' + esc(runs[i].file) + '</div></td>';
    html += '<td class="text-center ' + rateClass(passRate) + '"><div class="rate-big">' + pct(passRate) + '</div><div class="rate-detail">' + totalPassed + '/' + totalAssertions + '</div></td>';
    html += '<td>' + providers + '</td>';
    html += '<td class="text-center"><button class="btn" onclick="event.stopPropagation();showRun(' + i + ')">Details</button> <a class="btn btn-dim" href="/' + esc(runs[i].file) + '" onclick="event.stopPropagation()">JSON</a></td>';
    html += '</tr>';
  }

  html += '</tbody></table>';
  $("#app").innerHTML = html;

  // Draw chart
  if (chartData.length > 1) {
    destroyCharts();
    const ctx = document.getElementById("chart").getContext("2d");
    charts.push(new Chart(ctx, {
      type: "line",
      data: {
        labels: chartData.map(d => d.label),
        datasets: [{
          label: "Pass Rate (%)",
          data: chartData.map(d => d.value),
          borderColor: "rgb(59,130,246)",
          backgroundColor: "rgba(59,130,246,0.1)",
          fill: true, tension: 0.3, pointRadius: 4,
          pointBackgroundColor: "rgb(59,130,246)",
        }]
      },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + "%" } } },
        plugins: { legend: { display: false } }
      }
    }));
  }
}

function showRun(idx) {
  const { file, data } = runs[idx];
  const meta = data.metadata ?? {};
  const summary = data.provider_summary ?? {};
  const skillName = meta.skill_name ?? "Unknown";
  const ts = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : file;

  let html = '<button class="btn btn-back" onclick="renderList()">← All Runs</button>';
  html += '<h1>Run Details</h1>';
  html += '<p class="subtitle">' + esc(skillName) + ' — ' + esc(ts) + '</p>';

  // Provider comparison table
  html += '<h2>Provider Comparison</h2><table><thead><tr><th>Model</th><th class="text-center">Pass Rate</th><th class="text-center">Avg Time</th><th class="text-center">Avg Tokens</th><th class="text-center">Avg Cost</th></tr></thead><tbody>';
  for (const [key, stats] of Object.entries(summary)) {
    html += '<tr>';
    html += '<td class="font-medium">' + esc(key) + '</td>';
    html += '<td class="text-center ' + rateClass(stats.pass_rate.mean) + '">' + pct(stats.pass_rate.mean) + ' <span class="muted">±' + pct(stats.pass_rate.stddev) + '</span></td>';
    html += '<td class="text-center">' + fmt(stats.time_seconds.mean, 1) + 's <span class="muted">±' + fmt(stats.time_seconds.stddev, 1) + 's</span></td>';
    html += '<td class="text-center">' + fmt(stats.total_tokens.mean, 0) + ' <span class="muted">±' + fmt(stats.total_tokens.stddev, 0) + '</span></td>';
    html += '<td class="text-center">$' + fmt(stats.cost_usd.mean, 4) + ' <span class="muted">±$' + fmt(stats.cost_usd.stddev, 4) + '</span></td>';
    html += '</tr>';
  }
  html += '</tbody></table>';

  // Bar chart
  const models = Object.keys(summary);
  if (models.length > 0) {
    html += '<h2>Pass Rate by Model</h2><canvas id="chart"></canvas>';
  }

  // Eval details
  html += '<h2>Eval Details</h2>';
  const byEval = new Map();
  for (const r of (data.runs ?? [])) {
    if (!byEval.has(r.eval_id)) byEval.set(r.eval_id, []);
    byEval.get(r.eval_id).push(r);
  }

  for (const [evalId, evalRuns] of byEval) {
    html += '<details><summary>Eval ' + evalId + ' — ' + evalRuns.length + ' run(s)</summary><div class="eval-detail">';
    for (const r of evalRuns) {
      html += '<div class="run-card">';
      html += '<h4>' + esc(r.model) + ' (run ' + r.run_number + ')' + (r.error ? ' <span class="text-red">— error</span>' : '') + '</h4>';
      html += '<div class="stats-row">';
      html += '<span class="' + rateClass(r.result.pass_rate) + '">' + pct(r.result.pass_rate) + ' pass rate</span>';
      html += '<span>' + fmt(r.result.time_seconds, 1) + 's</span>';
      html += '<span>' + (r.result.total_tokens ?? 0) + ' tokens</span>';
      html += '<span>$' + fmt(r.result.cost_usd, 4) + '</span>';
      html += '</div>';
      if (r.error) {
        html += '<div class="error-banner">' + esc(r.error) + '</div>';
      }
      html += '<div class="expectations">';
      for (const e of (r.expectations ?? [])) {
        html += '<div class="expectation ' + (e.passed ? "pass" : "fail") + '">';
        html += '<span class="indicator">' + (e.passed ? "✓" : "✗") + '</span>';
        html += '<div><div class="assertion-text">' + esc(e.text) + '</div>';
        html += '<div class="evidence">' + esc(e.evidence) + '</div></div></div>';
      }
      html += '</div>';
      if (r.eval_feedback) {
        html += '<div class="feedback"><strong>Feedback:</strong> ' + esc(r.eval_feedback) + '</div>';
      }
      html += '</div>';
    }
    html += '</div></details>';
  }

  $("#app").innerHTML = html;

  // Draw bar chart
  if (models.length > 0) {
    destroyCharts();
    const ctx = document.getElementById("chart").getContext("2d");
    const vals = models.map(k => (summary[k].pass_rate.mean * 100).toFixed(1));
    const colors = models.map(k => {
      const r = summary[k].pass_rate.mean;
      return r >= HIGH_THRESHOLD ? "rgba(34,197,94,0.7)" : r >= MID_THRESHOLD ? "rgba(234,179,8,0.7)" : "rgba(239,68,68,0.7)";
    });
    charts.push(new Chart(ctx, {
      type: "bar",
      data: { labels: models, datasets: [{ label: "Pass Rate (%)", data: vals, backgroundColor: colors, borderRadius: 6 }] },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + "%" } } },
        plugins: { legend: { display: false } }
      }
    }));
  }
}

function destroyCharts() {
  for (const c of charts) c.destroy();
  charts = [];
}

init();
</script>
</body>
</html>"""
