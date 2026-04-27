import fs from "node:fs";
import path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import YAML from "yaml";
import { PROVIDER_REGISTRY, suggestSkillRoots } from "../config.js";
import { exitIfCancelled } from "../utils/prompt.js";

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
	prompts.outro(`${pc.green("✓")} Wrote ${outputPath}`);
}
