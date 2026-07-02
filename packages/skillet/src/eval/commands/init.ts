import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import YAML from "yaml";
import { ConfigFileSchema, PROVIDER_REGISTRY, suggestSkillRoots } from "../config.js";
import { writeMockManifests } from "../runner/mocks.js";
import { exitIfCancelled } from "../utils/prompt.js";

interface InitMock {
	openapi?: string;
	mcpServer?: string;
	expose: Array<"http" | "tools">;
}

const GITHUB_WORKFLOW_PATH = path.join(".github", "workflows", "skillet-evals.yml");
const GITHUB_WORKFLOW_CLEANUP_PATH = path.join(".github", "workflows", "skillet-evals-cleanup.yml");
const RENDER_YAML_PATH = "render.yaml";

const RENDER_YAML = `services:
  - type: web
    runtime: static
    name: skillet-reports
    branch: eval-reports
    buildCommand: ":"
    staticPublishPath: .
    headers:
      - path: /*
        name: X-Robots-Tag
        value: noindex
      - path: /*
        name: X-Frame-Options
        value: DENY
`;

const GITHUB_WORKFLOW_CLEANUP = String.raw`name: Skillet evals cleanup

on:
  pull_request:
    types: [closed]

permissions:
  contents: write

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Remove pr-\${{ github.event.pull_request.number }} from eval-reports
        env:
          PR: \${{ github.event.pull_request.number }}
          REPO: \${{ github.repository }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          git config --global user.name "github-actions[bot]"
          git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if ! git clone --depth 1 --branch eval-reports \
              "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO.git" reports; then
            echo "No eval-reports branch yet; nothing to clean."
            exit 0
          fi
          cd reports
          if [ -d "pr-$PR" ]; then
            git rm -rf "pr-$PR"
            git commit -m "cleanup: pr-$PR"
            git push origin eval-reports
          fi
`;

function buildEvalsWorkflow({ hosted }: { hosted: boolean }): string {
	const contentsPermission = hosted ? "write" : "read";

	const publishStep = hosted
		? String.raw`
      - name: Publish report to eval-reports branch
        if: github.event_name == 'pull_request'
        env:
          PR: \${{ github.event.pull_request.number }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if git ls-remote --exit-code origin eval-reports >/dev/null 2>&1; then
            git fetch origin eval-reports
            git worktree add /tmp/reports eval-reports
          else
            git worktree add --orphan -b eval-reports /tmp/reports
            (cd /tmp/reports && git rm -rf . >/dev/null 2>&1 || true)
          fi
          rm -rf "/tmp/reports/pr-$PR"
          mkdir -p "/tmp/reports/pr-$PR"
          cp -R .skillet-evals/report/. "/tmp/reports/pr-$PR/"
          cd /tmp/reports
          git add .
          git commit -m "report: pr-$PR (\${GITHUB_SHA:0:7})" || exit 0
          for i in 1 2 3; do
            git pull --rebase origin eval-reports || true
            git push origin eval-reports && break
            sleep $((RANDOM % 5 + 1))
          done
`
		: "";

	const commentEnv = hosted
		? String.raw`        env:
          SKILLET_REPORT_BASE_URL: \${{ vars.SKILLET_REPORT_BASE_URL }}
`
		: "";

	const linkLogic = hosted
		? String.raw`            const base = (process.env.SKILLET_REPORT_BASE_URL || "").replace(/\/$/, "");
            const link = base
              ? "Full report: " + base + "/pr-" + context.payload.pull_request.number + "/\n\n"
              : "";
`
		: `            const link = "";\n`;

	return String.raw`name: Skillet evals

on:
  workflow_dispatch:
    inputs:
      run_evals:
        description: "Run full model evals"
        required: true
        default: "true"
        type: choice
        options:
          - "true"
          - "false"
  pull_request:
    paths:
      - "skills/**"
      - "skillet.config.yaml"
      - "package.json"
      - "pnpm-lock.yaml"

permissions:
  contents: ${contentsPermission}
  pull-requests: write

jobs:
  skillet:
    runs-on: ubuntu-latest
    timeout-minutes: 45

    env:
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
      GOOGLE_API_KEY: \${{ secrets.GOOGLE_API_KEY }}
      SKILLET_SUMMARY_FILE: .skillet-evals/summary.md

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Validate Skillet evals
        run: pnpm skillet:validate

      - name: Run Skillet evals
        if: github.event_name == 'pull_request' || (github.event_name == 'workflow_dispatch' && inputs.run_evals == 'true')
        run: pnpm skillet:run

      - name: Generate static Skillet report
        if: always()
        run: pnpm exec skillet eval report --output .skillet-evals/report
${publishStep}
      - name: Write Skillet summary
        if: always()
        run: |
          mkdir -p "$(dirname "$SKILLET_SUMMARY_FILE")"

          node <<'NODE'
          const fs = require("node:fs");
          const path = require("node:path");

          const resultsRoot = ".skillet-evals/results";
          const summaryFile = process.env.SKILLET_SUMMARY_FILE;

          function walk(dir) {
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) return walk(full);
              return entry.isFile() && entry.name.endsWith(".json") ? [full] : [];
            });
          }

          function escapeCell(value) {
            return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
          }

          function escapeText(value) {
            return String(value ?? "").replace(/\n/g, " ").trim();
          }

          function percent(passed, total) {
            return total ? Math.round((passed / total) * 100) : 0;
          }

          function bar(pct, width = 10) {
            const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
            return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "] " + pct + "%";
          }

          function statusLabel(pct, errorCount) {
            if (errorCount > 0 && pct < 80) return "FAIL";
            if (pct >= 90 && errorCount === 0) return "PASS";
            if (pct >= 70 && errorCount <= 1) return "WARN";
            return "FAIL";
          }

          function formatSeconds(value) {
            return typeof value === "number" && value > 0 ? value.toFixed(1) + "s" : "-";
          }

          function formatUsd(value) {
            if (typeof value !== "number") return "-";
            return value === 0 ? "$0.00" : "$" + value.toFixed(value < 0.1 ? 3 : 2);
          }

          const allFiles = walk(resultsRoot);
          const filesByDir = new Map();
          for (const file of allFiles) {
            const dir = path.dirname(file);
            if (!filesByDir.has(dir)) filesByDir.set(dir, []);
            filesByDir.get(dir).push(file);
          }

          const files = Array.from(filesByDir.values())
            .map((dirFiles) => {
              const latest = dirFiles.find((file) => path.basename(file) === "latest.json");
              if (latest) return latest;
              return dirFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
            })
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

          const lines = ["## Skillet evals", ""];

          if (files.length === 0) {
            lines.push("No Skillet eval result files were produced.");
            fs.writeFileSync(summaryFile, lines.join("\n") + "\n");
            process.exit(0);
          }

          const benchmarks = files.map((file) => ({
            file,
            data: JSON.parse(fs.readFileSync(file, "utf8")),
          }));

          const runs = benchmarks.flatMap(({ data }) => data.runs ?? []);
          const total = runs.reduce((sum, run) => sum + (run.result?.total ?? 0), 0);
          const passed = runs.reduce((sum, run) => sum + (run.result?.passed ?? 0), 0);
          const passRate = percent(passed, total);
          const failedRuns = runs.filter((run) => run.error).length;
          const uniqueModels = [...new Set(runs.map((run) => run.model).filter(Boolean))];

          const skillSummaries = benchmarks
            .map(({ file, data }) => {
              const skillName = data.metadata?.skill_name ?? path.basename(path.dirname(file));
              const skillRuns = data.runs ?? [];
              const skillPassed = skillRuns.reduce((sum, run) => sum + (run.result?.passed ?? 0), 0);
              const skillTotal = skillRuns.reduce((sum, run) => sum + (run.result?.total ?? 0), 0);
              const skillErrors = skillRuns.filter((run) => run.error).length;
              const skillPct = percent(skillPassed, skillTotal);
              const models = [...new Set(skillRuns.map((run) => run.model).filter(Boolean))];
              return { file, data, skillName, runs: skillRuns, passed: skillPassed, total: skillTotal, pct: skillPct, errors: skillErrors, models };
            })
            .sort((a, b) => {
              if (b.errors !== a.errors) return b.errors - a.errors;
              if (a.pct !== b.pct) return a.pct - b.pct;
              return a.skillName.localeCompare(b.skillName);
            });

          const noteworthyRuns = runs
            .filter((run) => run.error || Math.round((run.result?.pass_rate ?? 0) * 100) < 100)
            .sort((a, b) => {
              const aPct = Math.round((a.result?.pass_rate ?? 0) * 100);
              const bPct = Math.round((b.result?.pass_rate ?? 0) * 100);
              if (!!b.error !== !!a.error) return Number(!!b.error) - Number(!!a.error);
              return aPct - bPct;
            })
            .slice(0, 8);

          lines.push("Overall: **" + statusLabel(passRate, failedRuns) + "** " + bar(passRate) + " (" + passed + "/" + total + " assertions passed)");
          lines.push("Skills: **" + skillSummaries.length + "**  |  Runs: **" + runs.length + "**  |  Runtime errors: **" + failedRuns + "**  |  Models: **" + (uniqueModels.join(", ") || "-") + "**");
          lines.push("");
          lines.push("### Skill summary");
          lines.push("");
          lines.push("| Skill | Status | Assertions | Runs | Errors | Models |");
          lines.push("| --- | --- | ---: | ---: | ---: | --- |");
          for (const summary of skillSummaries) {
            lines.push("| <code>" + escapeCell(summary.skillName) + "</code> | " + statusLabel(summary.pct, summary.errors) + " " + bar(summary.pct) + " | " + summary.passed + "/" + summary.total + " | " + summary.runs.length + " | " + summary.errors + " | " + escapeCell(summary.models.join(", ")) + " |");
          }
          lines.push("");

          if (noteworthyRuns.length > 0) {
            lines.push("### Needs attention");
            lines.push("");
            for (const run of noteworthyRuns) {
              const result = run.result ?? {};
              const pct = Math.round((result.pass_rate ?? 0) * 100);
              const detail = run.error
                ? "error: " + escapeText(run.error).slice(0, 120)
                : (result.passed ?? 0) + "/" + (result.total ?? 0) + " assertions";
              lines.push("- <code>" + escapeCell(run.model) + "</code> on eval **" + run.eval_id + "**: " + bar(pct, 8) + " - " + detail);
            }
            lines.push("");
          }

          lines.push("### Per-skill details");
          lines.push("");
          for (const summary of skillSummaries) {
            lines.push("<details><summary><code>" + escapeCell(summary.skillName) + "</code> - " + statusLabel(summary.pct, summary.errors) + " " + bar(summary.pct) + " - " + summary.passed + "/" + summary.total + " assertions</summary>");
            lines.push("");
            lines.push("Result file: <code>" + summary.file + "</code>");
            lines.push("");
            lines.push("| Eval | Model | Score | Assertions | Time | Cost | Notes |");
            lines.push("| --- | --- | --- | ---: | ---: | ---: | --- |");
            for (const run of summary.runs) {
              const result = run.result ?? {};
              const pct = Math.round((result.pass_rate ?? 0) * 100);
              const note = run.error
                ? "error: " + escapeCell(run.error)
                : result.errors
                  ? result.errors + " tool/runtime errors"
                  : "";
              lines.push("| " + run.eval_id + " | " + escapeCell(run.model) + " | " + bar(pct, 8) + " | " + (result.passed ?? 0) + "/" + (result.total ?? 0) + " | " + formatSeconds(result.time_seconds) + " | " + formatUsd(result.cost_usd) + " | " + note + " |");
            }
            lines.push("");
            lines.push("</details>");
            lines.push("");
          }

          fs.writeFileSync(summaryFile, lines.join("\n") + "\n");
          NODE

          cat "$SKILLET_SUMMARY_FILE" >> "$GITHUB_STEP_SUMMARY"

      - name: Comment Skillet summary on PR
        if: always() && github.event_name == 'pull_request'
${commentEnv}        uses: actions/github-script@v7
        with:
          script: |
            const fs = require("node:fs");
            const summaryPath = process.env.SKILLET_SUMMARY_FILE;
            const marker = "<!-- skillet-eval-summary -->";
            const summary = fs.existsSync(summaryPath)
              ? fs.readFileSync(summaryPath, "utf8")
              : "## Skillet evals\n\nNo summary was generated.\n";
${linkLogic}            const body = marker + "\n" + link + summary;

            const { owner, repo } = context.repo;
            const issue_number = context.payload.pull_request.number;
            const comments = await github.rest.issues.listComments({ owner, repo, issue_number, per_page: 100 });
            const existing = comments.data.find((comment) => comment.body?.includes(marker));

            if (existing) {
              await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
            } else {
              await github.rest.issues.createComment({ owner, repo, issue_number, body });
            }

      - name: Upload Skillet eval results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: skillet-eval-results
          path: |
            .skillet-evals/results
            .skillet-evals/summary.md
            .skillet-evals/report
          if-no-files-found: ignore
`;
}

function deriveRenderDeployUrl(): string {
	const fallback = "https://render.com/deploy?repo=<your-repo-url>";
	try {
		const remote = execSync("git remote get-url origin", {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!remote) return fallback;

		const sshMatch = remote.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/);
		const httpsUrl = sshMatch
			? `https://${sshMatch[1]}/${sshMatch[2]}`
			: remote.replace(/\.git\/?$/, "");

		return `https://render.com/deploy?repo=${httpsUrl}`;
	} catch {
		return fallback;
	}
}

async function maybeWriteFile(
	target: string,
	contents: string,
	{ overwritePromptMessage }: { overwritePromptMessage: string },
): Promise<boolean> {
	if (fs.existsSync(target)) {
		const overwrite = exitIfCancelled(
			await prompts.confirm({
				message: overwritePromptMessage,
				initialValue: false,
			}),
		);
		if (!overwrite) return false;
	}
	fs.mkdirSync(path.dirname(target) || ".", { recursive: true });
	fs.writeFileSync(target, contents);
	return true;
}

export async function runInit() {
	prompts.intro(pc.bold("skillet eval init"));

	const detected: Record<string, string> = {};
	for (const [provider, entry] of Object.entries(PROVIDER_REGISTRY)) {
		for (const envName of entry.envKeys) {
			if (process.env[envName]) {
				detected[provider] = envName;
				break;
			}
		}
	}

	if (Object.keys(detected).length > 0) {
		prompts.note(
			Object.entries(detected)
				.map(([p, env]) => `${pc.green("✓")} ${p} (${env})`)
				.join("\n"),
			"Detected API keys",
		);
	}

	const selectedProviders = exitIfCancelled(
		await prompts.multiselect({
			message: "Which providers do you want to configure?",
			options: Object.entries(PROVIDER_REGISTRY).map(([name, entry]) => ({
				value: name,
				label: entry.label,
				hint: detected[name] ? `${detected[name]} found` : undefined,
			})),
			initialValues: Object.keys(detected),
			required: true,
		}),
	) as string[];

	const providers: Array<{ name: string; model: string; apiKey: string }> = [];

	for (const name of selectedProviders) {
		const entry = PROVIDER_REGISTRY[name];
		const defaultModel = entry?.defaultModel ?? "";
		const modelOptions = (entry?.models ?? []).map((m) => ({
			value: m.id,
			label: `${m.label} (${m.tag})`,
			hint: m.id === defaultModel ? "default" : undefined,
		}));
		modelOptions.push({ value: "__custom__", label: "Custom model ID...", hint: undefined });

		let model = exitIfCancelled(
			await prompts.select({
				message: `Model for ${name}?`,
				options: modelOptions,
				initialValue: defaultModel,
			}),
		) as string;

		if (model === "__custom__") {
			model = exitIfCancelled(
				await prompts.text({
					message: `Custom model ID for ${name}?`,
					placeholder: defaultModel,
				}),
			) as string;
		}

		const envVar = detected[name] ?? entry?.envKeys[0] ?? `${name.toUpperCase()}_API_KEY`;
		providers.push({
			name,
			model: model || defaultModel,
			apiKey: `\${${envVar}}`,
		});
	}

	const graderProvider = selectedProviders[0];
	const detectedRoots = suggestSkillRoots(process.cwd());
	const localSkillRoots = exitIfCancelled(
		await prompts.text({
			message: "Local skill roots (comma-separated, optional)",
			placeholder: "skills, fixtures/skills, .agents/skills",
			initialValue: detectedRoots.join(", "),
		}),
	) as string;

	const mocks: Record<string, InitMock> = {};
	const configureMocks = exitIfCancelled(
		await prompts.confirm({
			message:
				"Configure mocks now from an OpenAPI spec or MCP server repo? (You can also run `skillet mock import` later.)",
			initialValue: false,
		}),
	);

	if (configureMocks) {
		let addAnother = true;
		while (addAnother) {
			const name = exitIfCancelled(
				await prompts.text({
					message: "Mock name",
					placeholder: "render-api",
					validate: (value) => {
						if (!value.trim()) return "Enter a mock name.";
						if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value.trim())) {
							return "Use letters, numbers, underscores, or dashes.";
						}
					},
				}),
			) as string;

			const openapi = exitIfCancelled(
				await prompts.text({
					message: "OpenAPI spec path or URL (optional)",
					placeholder: "./fixtures/openapi.json",
				}),
			) as string;

			const mcpServer = exitIfCancelled(
				await prompts.text({
					message: "MCP server repo/path (optional)",
					placeholder: "./fixtures/my-mcp-server",
				}),
			) as string;

			const expose = exitIfCancelled(
				await prompts.multiselect({
					message: "Expose this mock as",
					options: [
						{ value: "http", label: "Local mock HTTP API" },
						{ value: "tools", label: "MCP-style model tools" },
					],
					initialValues: ["http", "tools"],
					required: true,
				}),
			) as Array<"http" | "tools">;

			const mock: InitMock = { expose };
			if (openapi.trim()) mock.openapi = openapi.trim();
			if (mcpServer.trim()) mock.mcpServer = mcpServer.trim();

			if (!mock.openapi && !mock.mcpServer) {
				prompts.log.warn("No OpenAPI spec or MCP server path provided; skipping mock.");
			} else {
				mocks[name.trim()] = mock;
			}

			addAnother = Boolean(
				exitIfCancelled(
					await prompts.confirm({
						message: "Add another mock?",
						initialValue: false,
					}),
				),
			);
		}
	}

	const config = {
		providers,
		grader: {
			provider: graderProvider,
			model:
				providers.find((p) => p.name === graderProvider)?.model ??
				PROVIDER_REGISTRY[graderProvider]?.defaultModel,
		},
		skills: {
			roots: localSkillRoots
				.split(",")
				.map((root) => root.trim())
				.filter(Boolean),
		},
		...(Object.keys(mocks).length > 0 ? { mocks } : {}),
		settings: {
			maxSteps: 20,
			timeout: 300,
			runsPerProvider: 1,
		},
	};

	const yamlStr = YAML.stringify(config);
	const outputPath = "skillet.config.yaml";

	if (fs.existsSync(outputPath)) {
		const overwrite = exitIfCancelled(
			await prompts.confirm({ message: `${outputPath} already exists. Overwrite?` }),
		);
		if (!overwrite) {
			prompts.cancel("Cancelled.");
			process.exit(0);
		}
	}

	fs.writeFileSync(outputPath, yamlStr);
	if (Object.keys(mocks).length > 0) {
		const parsedConfig = ConfigFileSchema.parse(config);
		const manifests = await writeMockManifests(parsedConfig.mocks);
		prompts.log.success(`Wrote ${manifests.length} mock manifest(s)`);
	}

	const writeWorkflow = exitIfCancelled(
		await prompts.confirm({
			message: "Add a GitHub Actions workflow for Skillet evals?",
			initialValue: false,
		}),
	);

	let hostOnRender = false;
	if (writeWorkflow) {
		hostOnRender = Boolean(
			exitIfCancelled(
				await prompts.confirm({
					message: "Host eval reports on Render (one shared static site, per-PR sub-paths)?",
					initialValue: false,
				}),
			),
		);
	}

	if (writeWorkflow) {
		const wroteWorkflow = await maybeWriteFile(
			GITHUB_WORKFLOW_PATH,
			buildEvalsWorkflow({ hosted: hostOnRender }),
			{ overwritePromptMessage: `${GITHUB_WORKFLOW_PATH} already exists. Overwrite?` },
		);
		if (wroteWorkflow) prompts.log.success(`Wrote ${GITHUB_WORKFLOW_PATH}`);
	}

	if (hostOnRender) {
		const wroteRenderYaml = await maybeWriteFile(RENDER_YAML_PATH, RENDER_YAML, {
			overwritePromptMessage: `${RENDER_YAML_PATH} already exists. Overwrite?`,
		});
		if (wroteRenderYaml) {
			prompts.log.success(`Wrote ${RENDER_YAML_PATH}`);
		} else {
			prompts.log.warn(
				`Skipped ${RENDER_YAML_PATH}. Add a static site that serves the eval-reports branch:\n\n${RENDER_YAML}`,
			);
		}

		const wroteCleanup = await maybeWriteFile(
			GITHUB_WORKFLOW_CLEANUP_PATH,
			GITHUB_WORKFLOW_CLEANUP,
			{ overwritePromptMessage: `${GITHUB_WORKFLOW_CLEANUP_PATH} already exists. Overwrite?` },
		);
		if (wroteCleanup) prompts.log.success(`Wrote ${GITHUB_WORKFLOW_CLEANUP_PATH}`);

		const deployUrl = deriveRenderDeployUrl();
		prompts.note(
			[
				"1. Deploy the Blueprint to Render:",
				`   ${deployUrl}`,
				"2. Copy the resulting Static Site URL (e.g. https://skillet-reports-abcd.onrender.com).",
				"3. In your repo: Settings > Secrets and variables > Actions > Variables",
				"   Add SKILLET_REPORT_BASE_URL = <your service URL>",
				"",
				"PRs will then publish to <SKILLET_REPORT_BASE_URL>/pr-<N>/ and the link",
				"will be prepended to the PR comment automatically.",
			].join("\n"),
			"Hosted reports setup",
		);
	}

	prompts.outro(`${pc.green("✓")} Wrote ${outputPath}`);
}
