import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatResponse, LLMProvider } from "../../src/eval/providers/types.js";
import { runAgentLoop } from "../../src/eval/runner/agent-loop.js";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("runAgentLoop", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("emits heartbeat updates while a model call is pending", async () => {
		const pending = deferred<ChatResponse>();
		const onActivity = vi.fn();
		const provider: LLMProvider = {
			name: "test",
			modelId: "test-model",
			chat: vi.fn(() => pending.promise),
		};

		const runPromise = runAgentLoop({
			provider,
			system: "system",
			turns: ["hello"],
			tools: [],
			toolHandlers: {},
			heartbeatIntervalMs: 1000,
			onActivity,
		});

		await vi.advanceTimersByTimeAsync(2500);

		pending.resolve({
			content: "done",
			usage: { inputTokens: 1, outputTokens: 1 },
			stopReason: "end",
			latencyMs: 2500,
		});

		await runPromise;

		expect(onActivity).toHaveBeenCalledWith("step 1 — calling model…");
		expect(onActivity).toHaveBeenCalledWith("step 1 — still waiting on model… 1s");
		expect(onActivity).toHaveBeenCalledWith("step 1 — still waiting on model… 2s");
	});

	it("injects the next scripted turn when relevance check passes", async () => {
		const provider: LLMProvider = {
			name: "test",
			modelId: "test-model",
			chat: vi
				.fn()
				.mockResolvedValueOnce({
					content: "Which framework are you using?",
					usage: { inputTokens: 10, outputTokens: 5 },
					stopReason: "end",
					latencyMs: 100,
				})
				.mockResolvedValueOnce({
					content: "Use a static Blueprint with Vite defaults.",
					usage: { inputTokens: 12, outputTokens: 8 },
					stopReason: "end",
					latencyMs: 120,
				}),
		};
		const checkTurnRelevance = vi.fn().mockResolvedValue(true);

		const result = await runAgentLoop({
			provider,
			system: "system",
			turns: ["Help me deploy this frontend.", "It's a Vue app built with Vite."],
			tools: [],
			toolHandlers: {},
			checkTurnRelevance,
		});

		expect(checkTurnRelevance).toHaveBeenCalledWith(
			"Which framework are you using?",
			"It's a Vue app built with Vite.",
		);
		expect(provider.chat).toHaveBeenCalledTimes(2);
		expect(result.transcript).toHaveLength(2);
		expect(result.transcript[0]?.userMessage).toBe("It's a Vue app built with Vite.");
		expect(result.transcript[1]?.turn).toBe(1);
		expect(vi.mocked(provider.chat).mock.calls[1]?.[0].messages).toEqual([
			{ role: "user", content: "Help me deploy this frontend." },
			{ role: "assistant", content: "Which framework are you using?" },
			{ role: "user", content: "It's a Vue app built with Vite." },
		]);
	});

	it("stops before injecting the next turn when relevance check fails", async () => {
		const provider: LLMProvider = {
			name: "test",
			modelId: "test-model",
			chat: vi.fn().mockResolvedValue({
				content: "Here is the final answer.",
				usage: { inputTokens: 10, outputTokens: 5 },
				stopReason: "end",
				latencyMs: 100,
			}),
		};
		const checkTurnRelevance = vi.fn().mockResolvedValue(false);

		const result = await runAgentLoop({
			provider,
			system: "system",
			turns: ["Help me deploy this frontend.", "It's a Vue app built with Vite."],
			tools: [],
			toolHandlers: {},
			checkTurnRelevance,
		});

		expect(provider.chat).toHaveBeenCalledTimes(1);
		expect(checkTurnRelevance).toHaveBeenCalledTimes(1);
		expect(result.transcript).toHaveLength(1);
		expect(result.transcript[0]?.turnSkipped).toBe("It's a Vue app built with Vite.");
		expect(result.finalOutput).toBe("Here is the final answer.");
	});
});
