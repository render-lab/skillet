import fs from "node:fs";
import path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, resolveSkillPaths } from "../config.js";
import { createProvider } from "../providers/factory.js";
import { Spinner } from "../runner/spinner.js";
import type { EvalsFile } from "../schemas/evals.js";
import { EvalsFileSchema } from "../schemas/evals.js";
import { extractJson } from "../utils/json.js";
import { extractErrorMessage } from "../utils/error.js";

const FIXTURE_SYSTEM_PROMPT = `You generate realistic input files for AI agent skill evaluations.

Given a skill's instructions and its eval definitions (including assertions), you produce the actual file contents that the evals reference.

Return ONLY valid JSON mapping each file path to its string content (no other text):

{
  "fixtures/app.py": "import sqlite3\\n...",
  "fixtures/data.csv": "name,age\\nAlice,30\\n..."
}

Guidelines:
- Each file must be realistic and substantial enough to properly exercise the skill
- Files MUST contain the specific issues, patterns, or data that the eval assertions expect to find
- Read the assertions carefully — if an assertion says "identifies SQL injection", the file must contain an actual SQL injection vulnerability
- Keep each file under 200 lines
- Use realistic variable names, comments, and structure — not toy examples
- For code files, include a mix of good and bad patterns so the agent has something meaningful to find
- For data files, include enough rows/entries to be non-trivial (10-50 rows)`;

function buildFixturePrompt(
	skillContent: string,
	evalsJson: string,
	filePaths: string[],
): string {
	return `Generate the contents of the following fixture files for this skill's evals.

## Skill Instructions

${skillContent}

## Eval Definitions

${evalsJson}

## Files to Generate

${filePaths.map((f) => `- ${f}`).join("\n")}

Generate realistic file contents that satisfy all the assertions in the evals above. Return a JSON object mapping each file path to its string content.`;
}

/** Collect unique file paths from all evals. */
function collectFilePaths(evals: EvalsFile["evals"]): string[] {
	const paths = new Set<string>();
	for (const evalCase of evals) {
		for (const file of evalCase.files) {
			paths.add(file);
		}
	}
	return [...paths];
}

export interface FixturesOpts {
	skill: string;
	evals?: string;
	config?: string;
}

export async function runFixtures(opts: FixturesOpts) {
	const paths = resolveSkillPaths(opts.skill, opts.evals);

	if (!fs.existsSync(paths.skillFile)) {
		console.error(pc.red(`SKILL.md not found at ${paths.skillFile}`));
		process.exit(1);
	}
	if (!fs.existsSync(paths.evalsFile)) {
		console.error(pc.red(`evals.json not found at ${paths.evalsFile}`));
		console.error(
			`\nRun ${pc.bold(`skillet eval generate ${opts.skill}`)} first to create evals.json.\n`,
		);
		process.exit(1);
	}

	const rawEvals = fs.readFileSync(paths.evalsFile, "utf-8");
	const evalsFile = EvalsFileSchema.parse(JSON.parse(rawEvals));
	const filePaths = collectFilePaths(evalsFile.evals);

	if (filePaths.length === 0) {
		prompts.intro(pc.bold("skillet eval fixtures"));
		prompts.log.info("No fixture files referenced in evals — nothing to generate.");
		prompts.outro("Done");
		return;
	}

	prompts.intro(pc.bold("skillet eval fixtures"));

	const existing = filePaths.filter((f) => fs.existsSync(path.join(paths.skillDir, f)));
	if (existing.length > 0) {
		prompts.note(
			existing.map((f) => `  ${f}`).join("\n"),
			"Existing fixtures",
		);
		const overwrite = await prompts.confirm({
			message: `Overwrite ${existing.length} existing fixture(s)?`,
		});
		if (prompts.isCancel(overwrite)) {
			prompts.cancel("Cancelled.");
			process.exit(0);
		}
		if (!overwrite) {
			const remaining = filePaths.filter((f) => !existing.includes(f));
			if (remaining.length === 0) {
				prompts.log.info("All fixtures already exist — nothing to generate.");
				prompts.outro("Done");
				return;
			}
			filePaths.length = 0;
			filePaths.push(...remaining);
		}
	}

	prompts.log.info(`Generating ${pc.bold(String(filePaths.length))} fixture file(s)`);
	for (const f of filePaths) {
		prompts.log.info(`  ${pc.dim(f)}`);
	}

	const config = loadConfig({ configPath: opts.config });
	const provider = createProvider(config.providers[0]);
	const skillContent = fs.readFileSync(paths.skillFile, "utf-8");

	const spinner = new Spinner();
	spinner.start(`Generating fixtures with ${provider.modelId}`);

	const prompt = buildFixturePrompt(skillContent, rawEvals, filePaths);
	const chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [
		{ role: "user", content: prompt },
	];

	let fixtures: Record<string, string> | undefined;
	const MAX_ATTEMPTS = 2;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (attempt > 1) {
			spinner.start(`Retrying fixture generation (attempt ${attempt}/${MAX_ATTEMPTS})`);
		}

		const response = await provider.chat({
			system: FIXTURE_SYSTEM_PROMPT,
			messages: chatMessages,
			temperature: 0.3,
			maxTokens: 32_768,
		});

		spinner.stop();

		if (response.stopReason === "max_tokens") {
			prompts.log.error("Response was truncated (hit output token limit).");
			prompts.log.warning(response.content.slice(-500));
			process.exit(1);
		}

		try {
			const parsed = JSON.parse(extractJson(response.content));
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				throw new Error("Expected a JSON object mapping file paths to contents");
			}
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value !== "string") {
					throw new Error(`Value for "${key}" must be a string, got ${typeof value}`);
				}
			}
			fixtures = parsed as Record<string, string>;
			break;
		} catch (err) {
			if (attempt < MAX_ATTEMPTS) {
				prompts.log.warning(`Attempt ${attempt} produced invalid output — retrying`);
				chatMessages.push({ role: "assistant", content: response.content });
				chatMessages.push({
					role: "user",
					content: `The output failed validation: ${extractErrorMessage(err)}\n\nReturn a JSON object mapping each file path to its string content. No other text.`,
				});
			} else {
				prompts.log.error(`Failed to generate fixtures: ${extractErrorMessage(err)}`);
				process.exit(1);
			}
		}
	}

	if (!fixtures) {
		prompts.log.error("Failed to generate fixtures after all attempts.");
		process.exit(1);
	}

	let written = 0;
	for (const filePath of filePaths) {
		const content = fixtures[filePath];
		if (!content) {
			prompts.log.warning(`No content generated for ${filePath} — skipping`);
			continue;
		}
		const dest = path.join(paths.skillDir, filePath);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, content.endsWith("\n") ? content : `${content}\n`);
		prompts.log.success(dest);
		written++;
	}

	prompts.outro(`${written} fixture(s) created`);
}
