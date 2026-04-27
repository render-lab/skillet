export interface ModelEntry {
	id: string;
	label: string;
	tag: "balanced" | "reasoning" | "fast" | "code";
}

export interface ProviderRegistryEntry {
	label: string;
	envKeys: string[];
	defaultModel: string;
	models: ModelEntry[];
}

export const PROVIDER_REGISTRY: Record<string, ProviderRegistryEntry> = {
	anthropic: {
		label: "Anthropic",
		envKeys: ["ANTHROPIC_API_KEY"],
		defaultModel: "claude-sonnet-4-6",
		models: [
			{ id: "claude-sonnet-4-6", label: "Sonnet 4.6", tag: "balanced" },
			{ id: "claude-opus-4-6", label: "Opus 4.6", tag: "reasoning" },
			{ id: "claude-haiku-4-5", label: "Haiku 4.5", tag: "fast" },
		],
	},
	openai: {
		label: "OpenAI",
		envKeys: ["OPENAI_API_KEY"],
		defaultModel: "gpt-5.4",
		models: [
			{ id: "gpt-5.4", label: "GPT-5.4", tag: "balanced" },
			{ id: "o4-mini", label: "o4-mini", tag: "reasoning" },
			{ id: "gpt-5.3-codex", label: "GPT-5.3 Codex", tag: "code" },
		],
	},
	google: {
		label: "Google",
		envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
		defaultModel: "gemini-3.1-pro-preview",
		models: [
			{ id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", tag: "balanced" },
			{ id: "gemini-3-flash-preview", label: "Gemini 3 Flash", tag: "fast" },
			{ id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", tag: "fast" },
		],
	},
};

export const DEFAULT_MODELS: Record<string, string> = Object.fromEntries(
	Object.entries(PROVIDER_REGISTRY).map(([k, v]) => [k, v.defaultModel]),
);

export const ENV_KEY_MAP: Record<string, string[]> = Object.fromEntries(
	Object.entries(PROVIDER_REGISTRY).map(([k, v]) => [k, v.envKeys]),
);

type ProviderName = "anthropic" | "openai" | "google";

const MODEL_PREFIXES: [RegExp, ProviderName][] = [
	[/^claude-/, "anthropic"],
	[/^gpt-/, "openai"],
	[/^o\d/, "openai"],
	[/^chatgpt-/, "openai"],
	[/^gemini-/, "google"],
];

/** Infer the provider from a model name, or throw if unrecognized. */
export function inferProvider(model: string): ProviderName {
	for (const [pattern, provider] of MODEL_PREFIXES) {
		if (pattern.test(model)) return provider;
	}
	throw new Error(
		`Cannot infer provider for model "${model}". ` +
			`Use provider:model syntax (e.g. openai:${model}) or add it to the config file.`,
	);
}
