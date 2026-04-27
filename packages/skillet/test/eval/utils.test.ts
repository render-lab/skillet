import { describe, expect, it } from "vitest";
import { withTimeout } from "../../src/eval/utils/async.js";
import { extractErrorMessage } from "../../src/eval/utils/error.js";
import { extractJson } from "../../src/eval/utils/json.js";
import { mean, stddev } from "../../src/eval/utils/math.js";
import { rateLevel } from "../../src/eval/utils/rate.js";
import { truncate } from "../../src/eval/utils/string.js";

describe("extractJson", () => {
	it("extracts JSON from markdown fences", () => {
		const input = '```json\n{"key": "value"}\n```';
		expect(extractJson(input)).toBe('{"key": "value"}');
	});

	it("extracts JSON from plain fences", () => {
		const input = '```\n{"key": "value"}\n```';
		expect(extractJson(input)).toBe('{"key": "value"}');
	});

	it("extracts JSON from braces in text", () => {
		const input = 'Here is the result: {"key": "value"} — done';
		expect(extractJson(input)).toBe('{"key": "value"}');
	});

	it("returns text as-is when no JSON is found", () => {
		const input = "no json here";
		expect(extractJson(input)).toBe("no json here");
	});

	it("repairs literal newlines inside JSON strings", () => {
		const input = '{"prompt": "line one\nline two"}';
		const result = extractJson(input);
		expect(JSON.parse(result)).toEqual({ prompt: "line one\nline two" });
	});

	it("repairs trailing commas", () => {
		const input = '{"a": 1, "b": 2,}';
		const result = extractJson(input);
		expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
	});

	it("repairs JSON with code blocks containing backslashes", () => {
		const input =
			'```json\n{"prompt": "Here is code:\\n```ts\\napp.use(express.json());\\n```"}\n```';
		const result = extractJson(input);
		expect(() => JSON.parse(result)).not.toThrow();
	});

	it("passes through already-valid JSON without modification", () => {
		const input = '{"key": "value", "num": 42}';
		expect(extractJson(input)).toBe(input);
	});
});

describe("mean", () => {
	it("computes the mean of numbers", () => {
		expect(mean([1, 2, 3])).toBe(2);
	});

	it("returns 0 for empty array", () => {
		expect(mean([])).toBe(0);
	});

	it("handles single element", () => {
		expect(mean([5])).toBe(5);
	});
});

describe("stddev", () => {
	it("computes standard deviation", () => {
		expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
	});

	it("returns 0 for single element", () => {
		expect(stddev([5])).toBe(0);
	});

	it("returns 0 for empty array", () => {
		expect(stddev([])).toBe(0);
	});
});

describe("truncate", () => {
	it("does not truncate short strings", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	it("truncates long strings with ellipsis", () => {
		expect(truncate("hello world", 5)).toBe("hello…");
	});

	it("uses custom suffix", () => {
		expect(truncate("hello world", 5, "...")).toBe("hello...");
	});
});

describe("extractErrorMessage", () => {
	it("extracts message from Error instances", () => {
		expect(extractErrorMessage(new Error("test error"))).toBe("test error");
	});

	it("handles string values", () => {
		expect(extractErrorMessage("raw string")).toBe("raw string");
	});

	it("handles null/undefined", () => {
		expect(extractErrorMessage(null)).toBe("null");
		expect(extractErrorMessage(undefined)).toBe("undefined");
	});

	it("truncates very long messages", () => {
		const longMsg = "x".repeat(300);
		const result = extractErrorMessage(longMsg);
		expect(result.length).toBeLessThan(300);
		expect(result).toContain("…");
	});
});

describe("withTimeout", () => {
	it("resolves when promise completes in time", async () => {
		const result = await withTimeout(Promise.resolve(42), 1000, "test");
		expect(result).toBe(42);
	});

	it("rejects when promise times out", async () => {
		const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));
		await expect(withTimeout(slowPromise, 10, "test op")).rejects.toThrow("test op timed out");
	});

	it("evaluates timeout labels lazily", async () => {
		let phase = "calling model";
		const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));
		const timed = withTimeout(slowPromise, 10, () => `eval 1 — ${phase}`);
		phase = "grading";
		await expect(timed).rejects.toThrow("eval 1 — grading timed out");
	});

	it("propagates rejections", async () => {
		await expect(withTimeout(Promise.reject(new Error("inner")), 1000, "test")).rejects.toThrow(
			"inner",
		);
	});
});

describe("rateLevel", () => {
	it("returns green for high rates", () => {
		expect(rateLevel(0.9)).toBe("green");
		expect(rateLevel(0.8)).toBe("green");
	});

	it("returns yellow for mid rates", () => {
		expect(rateLevel(0.7)).toBe("yellow");
		expect(rateLevel(0.5)).toBe("yellow");
	});

	it("returns red for low rates", () => {
		expect(rateLevel(0.3)).toBe("red");
		expect(rateLevel(0)).toBe("red");
	});
});
