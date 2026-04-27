import type { ProviderConfig } from "../config/schema.js";
import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { OpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export function createProvider(config: ProviderConfig & { apiKey: string }): LLMProvider {
	switch (config.name) {
		case "anthropic":
			return new AnthropicProvider(config.apiKey, config.model);
		case "openai":
			return new OpenAIProvider(config.apiKey, config.model);
		case "google":
			return new GoogleProvider(config.apiKey, config.model);
		default:
			throw new Error(`Unknown provider: ${config.name}`);
	}
}
