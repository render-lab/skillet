import { describe, expect, it } from "vitest";
import { normalizeChatParams } from "../../src/eval/providers/base.js";

describe("normalizeChatParams", () => {
	it("does not default temperature when it is omitted", () => {
		const params = normalizeChatParams({
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(params.maxTokens).toBe(8192);
		expect(params.temperature).toBeUndefined();
	});

	it("preserves explicitly configured temperature", () => {
		const params = normalizeChatParams({
			system: "system",
			messages: [{ role: "user", content: "hello" }],
			temperature: 0.3,
		});

		expect(params.temperature).toBe(0.3);
	});
});
