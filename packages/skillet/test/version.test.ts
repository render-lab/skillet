import { describe, expect, it } from "vitest";
import { normalizeTag, resolveBestVersion } from "../src/resolver/version.js";

describe("normalizeTag", () => {
	it("normalizes v-prefixed tags", () => {
		expect(normalizeTag("v1.2.3")).toBe("1.2.3");
	});

	it("normalizes bare semver", () => {
		expect(normalizeTag("1.2.3")).toBe("1.2.3");
	});

	it("coerces partial versions", () => {
		expect(normalizeTag("v1.2")).toBe("1.2.0");
	});

	it("returns null for non-version strings", () => {
		expect(normalizeTag("not-a-version")).toBeNull();
	});
});

describe("resolveBestVersion", () => {
	const tags = ["v1.0.0", "v1.1.0", "v1.2.0", "v2.0.0", "v2.1.0"];

	it("resolves latest to highest version", () => {
		const result = resolveBestVersion(tags, "latest");
		expect(result?.version).toBe("2.1.0");
	});

	it("resolves caret range", () => {
		const result = resolveBestVersion(tags, "^1.0.0");
		expect(result?.version).toBe("1.2.0");
	});

	it("resolves tilde range", () => {
		const result = resolveBestVersion(tags, "~1.1.0");
		expect(result?.version).toBe("1.1.0");
	});

	it("resolves exact version", () => {
		const result = resolveBestVersion(tags, "2.0.0");
		expect(result?.version).toBe("2.0.0");
	});

	it("returns null when no match", () => {
		const result = resolveBestVersion(tags, "^3.0.0");
		expect(result).toBeNull();
	});

	it("returns null for empty tags", () => {
		const result = resolveBestVersion([], "^1.0.0");
		expect(result).toBeNull();
	});

	it("returns null for invalid range", () => {
		const result = resolveBestVersion(tags, "not-a-range");
		expect(result).toBeNull();
	});
});
