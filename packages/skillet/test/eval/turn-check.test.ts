import { describe, expect, it, vi } from "vitest";
import type { ChatResponse, LLMProvider } from "../../src/eval/providers/types.js";
import { createTurnChecker } from "../../src/eval/runner/turn-check.js";

function makeProvider(response: ChatResponse | Error): LLMProvider {
	return {
		name: "test",
		modelId: "test-model",
		chat: vi.fn(async (params) => {
			if (response instanceof Error) {
				throw response;
			}
			return response;
		}),
	};
}

describe("createTurnChecker", () => {
	it("returns true for a valid relevant=true JSON response", async () => {
		const provider = makeProvider({
			content: '{"relevant": true}',
			usage: { inputTokens: 1, outputTokens: 1 },
			stopReason: "end",
			latencyMs: 10,
		});

		const checkTurnRelevance = createTurnChecker(provider);
		await expect(
			checkTurnRelevance("What framework are you using?", "It's a Vue app."),
		).resolves.toBe(true);
		expect(vi.mocked(provider.chat).mock.calls[0]?.[0].maxTokens).toBe(32);
	});

	it("returns false for a valid relevant=false JSON response", async () => {
		const provider = makeProvider({
			content: '{"relevant": false}',
			usage: { inputTokens: 1, outputTokens: 1 },
			stopReason: "end",
			latencyMs: 10,
		});

		const checkTurnRelevance = createTurnChecker(provider);
		await expect(checkTurnRelevance("Here is the final answer.", "It's a Vue app.")).resolves.toBe(
			false,
		);
	});

	it("returns false for malformed output instead of failing open", async () => {
		const provider = makeProvider({
			content: "Sure, that seems relevant to me.",
			usage: { inputTokens: 1, outputTokens: 1 },
			stopReason: "end",
			latencyMs: 10,
		});

		const checkTurnRelevance = createTurnChecker(provider);
		await expect(
			checkTurnRelevance("What framework are you using?", "It's a Vue app."),
		).resolves.toBe(false);
	});

	it("returns false when the grader call fails", async () => {
		const provider = makeProvider(new Error("upstream timeout"));
		const checkTurnRelevance = createTurnChecker(provider);
		await expect(
			checkTurnRelevance("What framework are you using?", "It's a Vue app."),
		).resolves.toBe(false);
	});
});
