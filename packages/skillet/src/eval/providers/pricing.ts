/** Cost per 1M tokens in USD: [input, output] */
export const PRICING: Record<string, [number, number]> = {
	// Anthropic
	"claude-opus-4-6": [5.0, 25.0],
	"claude-sonnet-4-6": [3.0, 15.0],
	"claude-sonnet-4-5": [3.0, 15.0],
	"claude-haiku-4-5": [1.0, 5.0],

	// OpenAI
	"gpt-5.4": [5.0, 22.5],
	"gpt-5.3-codex": [1.75, 14.0],
	"gpt-5.2": [1.75, 14.0],
	"gpt-5.2-codex": [1.75, 14.0],
	"o4-mini": [1.1, 4.4],

	// Google
	"gemini-3.1-pro-preview": [2.0, 12.0],
	"gemini-3-flash-preview": [0.5, 3.0],
	"gemini-3.1-flash-lite-preview": [0.25, 1.5],
};

const warnedModels = new Set<string>();

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
	const rate = PRICING[model];
	if (!rate) {
		if (!warnedModels.has(model)) {
			warnedModels.add(model);
			console.error(`  ⚠ No pricing data for model "${model}" — cost will show as $0`);
		}
		return 0;
	}
	return (inputTokens / 1_000_000) * rate[0] + (outputTokens / 1_000_000) * rate[1];
}
