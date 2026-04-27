import fs from "node:fs";
import path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import YAML from "yaml";
import { PROVIDER_REGISTRY, suggestSkillRoots } from "../config.js";
import { exitIfCancelled } from "../utils/prompt.js";

interface InitIntegration {
	openapi?: string;
	mcpServer?: string;
	expose: Array<"http" | "tools">;
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
	prompts.outro(`${pc.green("✓")} Wrote ${outputPath}`);
}
