import { describe, expect, it } from "vitest";
import type { Message } from "../src/providers/types.js";
import {
	compactMessages,
	extractSnippet,
	messageSize,
	summarizeToolArgs,
} from "../src/runner/context.js";

describe("messageSize", () => {
	it("counts content length", () => {
		const msg: Message = { role: "user", content: "hello" };
		expect(messageSize(msg)).toBe(5);
	});

	it("includes tool call argument sizes", () => {
		const msg: Message = {
			role: "assistant",
			content: "ok",
			toolCalls: [{ id: "1", name: "bash", arguments: { command: "ls -la" } }],
		};
		const size = messageSize(msg);
		expect(size).toBeGreaterThan(2);
	});
});

describe("extractSnippet", () => {
	it("returns first meaningful line", () => {
		expect(extractSnippet("# Header\n\nSome text here")).toBe("Some text here");
	});

	it("skips empty lines and fences", () => {
		expect(extractSnippet("\n\n```python\ncode\n```\ntext")).toBe("code");
	});

	it("returns undefined for empty content", () => {
		expect(extractSnippet("")).toBeUndefined();
	});

	it("truncates long lines", () => {
		const longLine = "x".repeat(200);
		const result = extractSnippet(longLine);
		expect(result?.length).toBeLessThanOrEqual(81);
	});
});

describe("summarizeToolArgs", () => {
	it("returns command for bash", () => {
		expect(summarizeToolArgs("bash", { command: "ls" })).toBe("ls");
	});

	it("returns path for file tools", () => {
		expect(summarizeToolArgs("read_file", { path: "/foo/bar.txt" })).toBe("/foo/bar.txt");
		expect(summarizeToolArgs("write_file", { path: "/out.txt", content: "..." })).toBe("/out.txt");
		expect(summarizeToolArgs("list_directory", { path: "/" })).toBe("/");
	});

	it("truncates long bash commands", () => {
		const longCmd = "x".repeat(100);
		const result = summarizeToolArgs("bash", { command: longCmd });
		expect(result.length).toBeLessThanOrEqual(61);
	});

	it("falls back to JSON for unknown tools", () => {
		const result = summarizeToolArgs("custom", { a: 1 });
		expect(result).toBe('{"a":1}');
	});
});

describe("compactMessages", () => {
	it("does not modify messages under budget", () => {
		const messages: Message[] = [{ role: "user", content: "hello" }];
		compactMessages(messages, "system");
		expect(messages[0].content).toBe("hello");
	});
});
