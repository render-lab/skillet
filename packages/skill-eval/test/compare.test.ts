import { describe, expect, it } from "vitest";
import { type CompareResult, compareBenchmarks } from "../src/commands/compare.js";
import type { ProviderSummary } from "../src/schemas/benchmark.js";

function makeStats(passRate: number) {
	return {
		pass_rate: { mean: passRate, stddev: 0 },
		time_seconds: { mean: 5, stddev: 1 },
		total_tokens: { mean: 2000, stddev: 100 },
		cost_usd: { mean: 0.01, stddev: 0.001 },
	};
}

describe("compareBenchmarks", () => {
	it("reports no regression when rates are equal", () => {
		const golden: ProviderSummary = { "model-a": makeStats(0.9) };
		const current: ProviderSummary = { "model-a": makeStats(0.9) };
		const results = compareBenchmarks(golden, current);

		expect(results).toHaveLength(1);
		expect(results[0].regressed).toBe(false);
		expect(results[0].delta).toBe(0);
	});

	it("reports no regression when rate improves", () => {
		const golden: ProviderSummary = { "model-a": makeStats(0.8) };
		const current: ProviderSummary = { "model-a": makeStats(1.0) };
		const results = compareBenchmarks(golden, current);

		expect(results[0].regressed).toBe(false);
		expect(results[0].delta).toBeCloseTo(0.2);
	});

	it("detects a single provider regression", () => {
		const golden: ProviderSummary = {
			"model-a": makeStats(1.0),
			"model-b": makeStats(0.9),
		};
		const current: ProviderSummary = {
			"model-a": makeStats(1.0),
			"model-b": makeStats(0.7),
		};
		const results = compareBenchmarks(golden, current);

		const regressed = results.filter((r) => r.regressed);
		expect(regressed).toHaveLength(1);
		expect(regressed[0].provider).toBe("model-b");
		expect(regressed[0].delta).toBeCloseTo(-0.2);
	});

	it("treats a provider missing from current as 0% (regression)", () => {
		const golden: ProviderSummary = {
			"model-a": makeStats(0.9),
			"model-b": makeStats(0.8),
		};
		const current: ProviderSummary = { "model-a": makeStats(0.9) };
		const results = compareBenchmarks(golden, current);

		const missing = results.find((r) => r.provider === "model-b");
		expect(missing).toBeDefined();
		expect(missing!.currentRate).toBe(0);
		expect(missing!.regressed).toBe(true);
	});

	it("handles multiple providers with mixed results", () => {
		const golden: ProviderSummary = {
			"model-a": makeStats(0.8),
			"model-b": makeStats(0.9),
			"model-c": makeStats(0.7),
		};
		const current: ProviderSummary = {
			"model-a": makeStats(0.9),
			"model-b": makeStats(0.85),
			"model-c": makeStats(0.7),
		};
		const results = compareBenchmarks(golden, current);

		expect(results.find((r) => r.provider === "model-a")!.regressed).toBe(false);
		expect(results.find((r) => r.provider === "model-b")!.regressed).toBe(true);
		expect(results.find((r) => r.provider === "model-c")!.regressed).toBe(false);
	});
});
