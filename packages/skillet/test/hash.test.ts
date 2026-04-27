import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashDirectory, hashString } from "../src/utils/hash.js";

describe("hashString", () => {
	it("produces consistent SHA256 hashes", () => {
		const a = hashString("hello");
		const b = hashString("hello");
		expect(a).toBe(b);
		expect(a).toHaveLength(64);
	});

	it("produces different hashes for different inputs", () => {
		expect(hashString("hello")).not.toBe(hashString("world"));
	});
});

describe("hashDirectory", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "hash-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("produces a deterministic hash for a directory", async () => {
		await writeFile(path.join(tmpDir, "a.txt"), "hello");
		await writeFile(path.join(tmpDir, "b.txt"), "world");

		const hash1 = await hashDirectory(tmpDir);
		const hash2 = await hashDirectory(tmpDir);
		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64);
	});

	it("changes when file content changes", async () => {
		await writeFile(path.join(tmpDir, "a.txt"), "hello");
		const hash1 = await hashDirectory(tmpDir);

		await writeFile(path.join(tmpDir, "a.txt"), "changed");
		const hash2 = await hashDirectory(tmpDir);

		expect(hash1).not.toBe(hash2);
	});
});
