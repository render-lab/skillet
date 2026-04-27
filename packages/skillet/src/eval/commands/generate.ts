import fs from "node:fs";
import path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import {
	PROVIDER_REGISTRY,
	inferProvider,
	loadConfig,
	resolveSkillPaths,
	resolveSkillSelection,
} from "../config.js";
import { createProvider } from "../providers/factory.js";
import { PRICING } from "../providers/pricing.js";
import { Spinner } from "../runner/spinner.js";
import { EvalsFileSchema, getTurns } from "../schemas/evals.js";
import { exitWithMissingSkillFile } from "../utils/cli-error.js";
import { extractJson } from "../utils/json.js";
import { exitIfCancelled } from "../utils/prompt.js";

const MAX_REFERENCE_SIZE = 50_000;

const GENERATE_SYSTEM_PROMPT = `You generate eval test cases for AI agent skills. Given a skill's instructions and reference material, you produce a JSON file that defines test prompts and assertions.

Return ONLY valid JSON matching this exact structure (no other text):

{
  "skill_name": "<name from the skill>",
  "models": ["<model1>", "<model2>"],
  "evals": [
    {
      "id": 1,
      "prompt": "<a realistic user prompt that exercises a key capability>",
      "expected_output": "<description of what correct behavior looks like>",
      "files": [],
      "assertions": [
        "<specific, verifiable assertion about the agent's behavior>"
      ]
    }
  ]
}

For multi-turn conversations, use "turns" instead of "prompt":

{
  "id": 2,
  "turns": [
    "First user message — triggers the agent to ask a question",
    "User's reply to the agent's question"
  ],
  "expected_output": "...",
  "assertions": [...]
}

Use "turns" when the skill involves clarification, follow-up questions, or back-and-forth. Use "prompt" for single-turn tasks. Do NOT use both in the same eval.

Guidelines:
- CRITICAL: Each "prompt" or "turns" entry must be under 500 characters. Describe the project and issues briefly in prose. Use at most one short code snippet (under 6 lines) per prompt. Never embed full files.
- Each eval should test a distinct capability of the skill
- Prompts should sound like a real user asking for help
- Assertions should be specific and objectively verifiable (not vague)
- Include 3-6 assertions per eval
- expected_output describes the ideal behavior, assertions are the checkable claims
- Use the "files" array to reference input files the eval needs (e.g. "fixtures/app.py", "fixtures/data.csv"). Use "fixtures/" as the subdirectory. Leave "files" empty only when the agent creates everything from scratch.
- Use "turns" when the skill involves clarification, follow-up questions, ambiguous requests that need disambiguation, iterative refinement, or any back-and-forth. If the skill would reasonably involve the agent asking the user something before proceeding, model that as a multi-turn eval.
- When using "turns", the first message is intentionally vague or incomplete so the agent must ask a clarifying question. The second message is the user's reply. You can use 2-4 turns.
- When using "turns", assertions can reference behavior across turns (e.g., "After the user provides X, the agent does Y")
- A good eval suite mixes single-turn and multi-turn evals. Use multi-turn whenever the scenario naturally calls for it — don't force everything into a single prompt.`;

function buildGeneratePrompt(
	skillContent: string,
	references: Array<{ name: string; content: string }>,
	count: number,
	models: string[],
): string {
	let prompt = `Generate ${count} eval test cases for the following skill.

## Skill Instructions

${skillContent}`;

	if (references.length > 0) {
		prompt += "\n\n## Reference Material\n";
		for (const ref of references) {
			prompt += `\n### ${ref.name}\n\n${ref.content}\n`;
		}
	}

	prompt += `\n\nGenerate exactly ${count} evals that cover the skill's most important capabilities. Each eval should test something different. Use multi-turn "turns" for any eval where the user's request is ambiguous, incomplete, or where the agent should ask for clarification before proceeding. Use single-turn "prompt" for straightforward tasks.`;
	prompt += `\n\nSet the "models" field to: ${JSON.stringify(models)}`;

	return prompt;
}

function readReferences(skillDir: string): Array<{ name: string; content: string }> {
	const refsDir = path.join(skillDir, "references");
	if (!fs.existsSync(refsDir) || !fs.statSync(refsDir).isDirectory()) return [];

	const refs: Array<{ name: string; content: string }> = [];
	for (const entry of fs.readdirSync(refsDir)) {
		const fullPath = path.join(refsDir, entry);
		if (fs.statSync(fullPath).isFile() && entry.endsWith(".md")) {
			const content = fs.readFileSync(fullPath, "utf-8");
			if (content.length < MAX_REFERENCE_SIZE) {
				refs.push({ name: entry, content });
			}
		}
	}
	return refs;
}

function formatCost(model: string): string {
	const rate = PRICING[model];
	if (!rate) return "";
	return `$${rate[0]}/$${rate[1]} per 1M tok`;
}

function buildModelOptions(): Array<{ value: string; label: string; hint?: string }> {
	const groups: Record<string, string[]> = {};
	for (const model of Object.keys(PRICING)) {
		try {
			const provider = inferProvider(model);
			if (!groups[provider]) groups[provider] = [];
			groups[provider].push(model);
		} catch {
			// skip unknown
		}
	}

	const options: Array<{ value: string; label: string; hint?: string }> = [];

	for (const [provider, models] of Object.entries(groups)) {
		const entry = PROVIDER_REGISTRY[provider];
		for (const model of models) {
			const isDefault = model === entry?.defaultModel;
			options.push({
				value: model,
				label: `${entry?.label ?? provider} — ${model}`,
				hint: [isDefault ? "default" : "", formatCost(model)].filter(Boolean).join(" · "),
			});
		}
	}

	return options;
}

interface GenerateOpts {
	skills?: string[];
	count?: string;
	config?: string;
}

export async function runGenerate(opts: GenerateOpts) {
	const count = Number(opts.count ?? 3);
	const config = loadConfig({ configPath: opts.config });
	const skills = resolveSkillSelection(opts.skills, config.skillRoots);

	prompts.intro(pc.bold("skillet eval generate"));
	const modelOptions = buildModelOptions();
	const defaultModels = Object.values(PROVIDER_REGISTRY).map((e) => e.defaultModel);

	const models = exitIfCancelled(
		await prompts.multiselect({
			message: "Which models should evals run against?",
			options: modelOptions,
			initialValues: defaultModels.filter((m) => modelOptions.some((o) => o.value === m)),
			required: true,
		}),
	) as string[];

	const finalCount = Number(
		exitIfCancelled(
			await prompts.text({
				message: "How many evals to generate?",
				initialValue: String(count),
				validate: (v) =>
					Number.isNaN(Number(v)) || Number(v) < 1 ? "Enter a number >= 1" : undefined,
			}),
		),
	);

	const provider = createProvider(config.providers[0]);

	prompts.log.info(`Generator: ${pc.bold(provider.modelId)}`);
	prompts.log.info(`Models: ${pc.bold(models.join(", "))}`);
	prompts.log.info(`Count: ${pc.bold(String(finalCount))} eval(s)`);

	for (const [index, skill] of skills.entries()) {
		if (index > 0) console.log("");
		await runGenerateForSkill({
			skill,
			models,
			count: finalCount,
			provider,
		});
	}

	prompts.outro(`${skills.length} skill(s) processed`);
}

async function runGenerateForSkill(opts: {
	skill: string;
	models: string[];
	count: number;
	provider: ReturnType<typeof createProvider>;
}) {
	const paths = resolveSkillPaths(opts.skill);
	const skillArg = opts.skill || ".";

	if (!fs.existsSync(paths.skillFile)) {
		exitWithMissingSkillFile("generate", skillArg, paths.skillFile);
	}

	prompts.log.info(`Skill: ${pc.bold(paths.skillDir)}`);
	prompts.log.info(`Generator: ${pc.bold(opts.provider.modelId)}`);
	prompts.log.info(`Models: ${pc.bold(opts.models.join(", "))}`);
	prompts.log.info(`Count: ${pc.bold(String(opts.count))} eval(s)`);

	const skillContent = fs.readFileSync(paths.skillFile, "utf-8");
	const references = readReferences(paths.skillDir);
	if (references.length > 0) {
		prompts.log.info(`Found ${references.length} reference file(s)`);
	}

	const spinner = new Spinner();
	spinner.start(`Generating ${opts.count} eval(s) with ${opts.provider.modelId}`);

	const prompt = buildGeneratePrompt(skillContent, references, opts.count, opts.models);

	const chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [
		{ role: "user", content: prompt },
	];

	let evalsFile: ReturnType<typeof EvalsFileSchema.parse> | undefined;
	const MAX_ATTEMPTS = 2;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (attempt > 1) {
			spinner.start(`Retrying generation (attempt ${attempt}/${MAX_ATTEMPTS})`);
		}

		const response = await opts.provider.chat({
			system: GENERATE_SYSTEM_PROMPT,
			messages: chatMessages,
			temperature: 0.3,
			maxTokens: 32_768,
		});

		spinner.stop();

		if (response.stopReason === "max_tokens") {
			prompts.log.error(
				"Response was truncated (hit output token limit). Try generating fewer evals or use a model with a larger output window.",
			);
			prompts.log.warning(response.content.slice(-500));
			process.exit(1);
		}

		try {
			const raw = JSON.parse(extractJson(response.content));
			evalsFile = EvalsFileSchema.parse(raw);
			break;
		} catch (err) {
			if (attempt < MAX_ATTEMPTS) {
				const { extractErrorMessage } = await import("../utils/error.js");
				const errMsg = extractErrorMessage(err);
				prompts.log.warning(`Attempt ${attempt} produced invalid JSON — retrying`);

				chatMessages.push({ role: "assistant", content: response.content });
				chatMessages.push({
					role: "user",
					content: `The JSON you produced failed validation:\n\n${errMsg}\n\nPlease produce the complete, corrected JSON. Every eval MUST include "expected_output" (string) and "assertions" (array of strings). Keep each "prompt" or "turns" entry under 500 characters.`,
				});
			} else {
				const { extractErrorMessage } = await import("../utils/error.js");
				prompts.log.error(`Failed to parse generated evals: ${extractErrorMessage(err)}`);
				prompts.log.info(
					`stopReason: ${response.stopReason} · outputTokens: ${response.usage.outputTokens}`,
				);
				prompts.log.warning(response.content.slice(-500));
				process.exit(1);
			}
		}
	}

	if (!evalsFile) {
		prompts.log.error("Failed to generate valid evals after all attempts.");
		process.exit(1);
	}

	// Ensure the selected models are in the output
	evalsFile.models = opts.models;

	const outputPath = path.join(paths.skillDir, "evals.json");
	let writePath = outputPath;

	if (fs.existsSync(outputPath)) {
		const overwrite = exitIfCancelled(
			await prompts.confirm({ message: `${outputPath} already exists. Overwrite?` }),
		);
		if (!overwrite) {
			writePath = path.join(paths.skillDir, "evals.generated.json");
		}
	}

	fs.writeFileSync(writePath, `${JSON.stringify(evalsFile, null, 2)}\n`);
	prompts.log.success(`Wrote ${writePath}`);

	console.log("");
	for (const evalCase of evalsFile.evals) {
		const firstMsg = getTurns(evalCase)[0] ?? "";
		const truncated = firstMsg.length > 80 ? `${firstMsg.slice(0, 80)}…` : firstMsg;
		console.log(`  ${pc.bold(`Eval ${evalCase.id}`)}: ${truncated}`);
		for (const assertion of evalCase.assertions) {
			console.log(`    ${pc.dim("·")} ${pc.dim(assertion)}`);
		}
	}

	prompts.log.success(
		`${opts.models.length} model(s) configured · ${evalsFile.evals.length} eval(s) generated`,
	);
}
