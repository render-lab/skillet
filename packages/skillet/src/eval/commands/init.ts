import fs from "node:fs";
import path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import YAML from "yaml";
import { ConfigFileSchema, PROVIDER_REGISTRY, suggestSkillRoots } from "../config.js";
import { writeIntegrationMockManifests } from "../runner/integration-mocks.js";
import { exitIfCancelled } from "../utils/prompt.js";

interface InitIntegration {
	openapi?: string;
	mcpServer?: string;
	expose: Array<"http" | "tools">;
}

const GITHUB_WORKFLOW_PATH = path.join(".github", "workflows", "skillet-evals.yml");

const GITHUB_WORKFLOW = String.raw`name: Skillet evals

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
      - "skillet.eval.yaml"
      - "package.json"
      - "pnpm-lock.yaml"

permissions:
  contents: read
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
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require("node:fs");
            const summaryPath = process.env.SKILLET_SUMMARY_FILE;
            const marker = "<!-- skillet-eval-summary -->";
            const summary = fs.existsSync(summaryPath)
              ? fs.readFileSync(summaryPath, "utf8")
              : "## Skillet evals\n\nNo summary was generated.\n";
            const body = marker + "\n" + summary;

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

	const integrations: Record<string, InitIntegration> = {};
	const configureIntegrations = exitIfCancelled(
		await prompts.confirm({
			message: "Configure integration mocks from OpenAPI or an MCP server repo?",
			initialValue: false,
		}),
	);

	if (configureIntegrations) {
		let addAnother = true;
		while (addAnother) {
			const name = exitIfCancelled(
				await prompts.text({
					message: "Integration name",
					placeholder: "render",
					validate: (value) => {
						if (!value.trim()) return "Enter an integration name.";
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
					message: "Expose this integration as",
					options: [
						{ value: "http", label: "Local mock HTTP API" },
						{ value: "tools", label: "MCP-style model tools" },
					],
					initialValues: ["http", "tools"],
					required: true,
				}),
			) as Array<"http" | "tools">;

			const integration: InitIntegration = { expose };
			if (openapi.trim()) integration.openapi = openapi.trim();
			if (mcpServer.trim()) integration.mcpServer = mcpServer.trim();

			if (!integration.openapi && !integration.mcpServer) {
				prompts.log.warn("No OpenAPI spec or MCP server path provided; skipping integration.");
			} else {
				integrations[name.trim()] = integration;
			}

			addAnother = Boolean(
				exitIfCancelled(
					await prompts.confirm({
						message: "Add another integration mock?",
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
		...(Object.keys(integrations).length > 0 ? { integrations } : {}),
		settings: {
			maxSteps: 20,
			timeout: 300,
			runsPerProvider: 1,
			temperature: 0,
		},
	};

	const yamlStr = YAML.stringify(config);
	const outputPath = "skillet.eval.yaml";

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
	if (Object.keys(integrations).length > 0) {
		const parsedConfig = ConfigFileSchema.parse(config);
		const manifests = await writeIntegrationMockManifests(parsedConfig.integrations);
		prompts.log.success(`Wrote ${manifests.length} integration mock manifest(s)`);
	}

	const writeWorkflow = exitIfCancelled(
		await prompts.confirm({
			message: "Add a GitHub Actions workflow for Skillet evals?",
			initialValue: false,
		}),
	);
	if (writeWorkflow) {
		let shouldWriteWorkflow = true;
		if (fs.existsSync(GITHUB_WORKFLOW_PATH)) {
			shouldWriteWorkflow = Boolean(
				exitIfCancelled(
					await prompts.confirm({
						message: `${GITHUB_WORKFLOW_PATH} already exists. Overwrite?`,
						initialValue: false,
					}),
				),
			);
		}
		if (shouldWriteWorkflow) {
			fs.mkdirSync(path.dirname(GITHUB_WORKFLOW_PATH), { recursive: true });
			fs.writeFileSync(GITHUB_WORKFLOW_PATH, GITHUB_WORKFLOW);
			prompts.log.success(`Wrote ${GITHUB_WORKFLOW_PATH}`);
		}
	}
	prompts.outro(`${pc.green("✓")} Wrote ${outputPath}`);
}
