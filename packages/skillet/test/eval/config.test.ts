import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/eval/config/loader.js";

describe("loadConfig", () => {
	it("throws a helpful error when an explicit config path does not exist", () => {
		expect(() => loadConfig({ configPath: "/definitely/missing/skillet.eval.yaml" })).toThrow(
			/Config file not found/,
		);
	});
});
