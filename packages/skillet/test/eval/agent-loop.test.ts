import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../../src/eval/runner/agent-loop.js";
import type { ChatResponse, LLMProvider } from "../../src/eval/providers/types.js";

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
});
