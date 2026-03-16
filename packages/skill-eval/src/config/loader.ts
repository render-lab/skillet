import fs from "node:fs";
import YAML from "yaml";
import { resolveApiKey } from "./env.js";
import { DEFAULT_MODELS, ENV_KEY_MAP, inferProvider } from "./registry.js";
import {
	type CliOverrides,
	type Config,
	ConfigFileSchema,
	type ProviderConfig,
	type ResolvedConfig,
} from "./schema.js";

/** Auto-detect providers from environment variables. */
function detectProviders(): ProviderConfig[] {
	const providers: ProviderConfig[] = [];
	for (const [name, envNames] of Object.entries(ENV_KEY_MAP)) {
		for (const envName of envNames) {
			if (process.env[envName]) {
				providers.push({
					name: name as ProviderConfig["name"],
					model: DEFAULT_MODELS[name],
					apiKey: process.env[envName],
				});
				break;
			}
		}
	}
	return providers;
}

/**
 * Load config from YAML file (if present), merge with env var auto-detection,
 * and apply CLI overrides. Returns a fully resolved config with API keys.
 */
export function loadConfig(overrides: CliOverrides = {}): ResolvedConfig {
	const configPath = overrides.configPath ?? "skill-eval.yaml";
	let fileConfig: Config | undefined;

	if (fs.existsSync(configPath)) {
		const raw = fs.readFileSync(configPath, "utf-8");
		const parsed = YAML.parse(raw);
		fileConfig = ConfigFileSchema.parse(parsed);
	}

	let providers = fileConfig?.providers ?? detectProviders();

	if (overrides.providers?.length) {
		providers = providers.filter((p) => overrides.providers?.includes(p.name));
	}

	if (overrides.models?.length) {
		type ProviderName = "anthropic" | "openai" | "google";
		providers = overrides.models.map((spec) => {
			let name: ProviderName;
			let model: string;

			if (spec.includes(":")) {
				const [n, m] = spec.split(":");
				name = n as ProviderName;
				model = m;
			} else {
				name = inferProvider(spec);
				model = spec;
			}

			return { name, model, apiKey: resolveApiKey(name) };
		});
	}

	const skipped: string[] = [];
	const resolved = providers
		.map((p) => {
			const apiKey = resolveApiKey(p.name, p.apiKey);
			if (!apiKey) {
				skipped.push(`${p.model} (no ${ENV_KEY_MAP[p.name]?.[0] ?? `${p.name} API key`})`);
				return null;
			}
			return { ...p, apiKey };
		})
		.filter((p): p is ProviderConfig & { apiKey: string } => p !== null);

	if (skipped.length > 0) {
		console.error(`  ⚠ Skipped: ${skipped.join(", ")}\n`);
	}

	if (resolved.length === 0) {
		throw new Error(
			"No providers configured. Set API keys in the environment " +
				"(ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY) " +
				"or create a skill-eval.yaml config file.",
		);
	}

	const graderSource = fileConfig?.grader ?? {
		provider: resolved[0].name,
		model: resolved[0].model,
	};
	const graderKey = resolveApiKey(graderSource.provider, undefined);
	if (!graderKey) {
		throw new Error(`No API key found for grader provider "${graderSource.provider}"`);
	}

	const settings = fileConfig?.settings ?? ConfigFileSchema.shape.settings.parse(undefined);
	if (overrides.runs) settings.runsPerProvider = overrides.runs;
	if (overrides.timeout) settings.timeout = overrides.timeout;

	return {
		providers: resolved,
		grader: { ...graderSource, apiKey: graderKey },
		settings,
	};
}
