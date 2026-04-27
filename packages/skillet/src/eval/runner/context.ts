import type { Message } from "../providers/types.js";
import { truncate } from "../utils/string.js";

const CHARS_PER_TOKEN = 4;
const MAX_CONTEXT_TOKENS = 80_000;
const MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;
const COMPACT_MIN_LENGTH = 200;
const PROTECTED_TAIL_MESSAGES = 6;
const SNIPPET_MAX_LENGTH = 80;
const TOOL_ARG_DISPLAY_MAX = 60;

export function messageSize(m: Message): number {
	let size = m.content?.length ?? 0;
	if (m.toolCalls) {
		for (const tc of m.toolCalls) {
			size += JSON.stringify(tc.arguments).length;
		}
	}
	return size;
}

export function totalPayloadSize(system: string, messages: Message[]): number {
	return system.length + messages.reduce((sum, m) => sum + messageSize(m), 0);
}

/**
 * If total message payload exceeds the context budget, aggressively
 * truncate older messages (oldest first). Protects the last few messages.
 */
export function compactMessages(messages: Message[], system: string) {
	if (totalPayloadSize(system, messages) <= MAX_CONTEXT_CHARS) return;

	const PLACEHOLDER = "[truncated]";

	for (let i = 1; i < messages.length - PROTECTED_TAIL_MESSAGES; i++) {
		if (totalPayloadSize(system, messages) <= MAX_CONTEXT_CHARS) break;
		const msg = messages[i];
		if (msg.content && msg.content.length > COMPACT_MIN_LENGTH) {
			msg.content = PLACEHOLDER;
		}
		if (msg.toolCalls) {
			for (const tc of msg.toolCalls) {
				for (const [key, val] of Object.entries(tc.arguments)) {
					if (typeof val === "string" && val.length > COMPACT_MIN_LENGTH) {
						tc.arguments[key] = PLACEHOLDER;
					}
				}
			}
		}
	}
}

/** Extract the first meaningful line from model output as a display snippet. */
export function extractSnippet(content: string): string | undefined {
	if (!content || typeof content !== "string") return undefined;
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.startsWith("<"))
			continue;
		return truncate(trimmed, SNIPPET_MAX_LENGTH);
	}
	return undefined;
}

/** Produce a compact display string for tool call arguments. */
export function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
	if (name === "bash" && typeof args.command === "string") {
		return truncate(args.command, TOOL_ARG_DISPLAY_MAX);
	}
	if (
		(name === "read_file" || name === "write_file" || name === "list_directory") &&
		typeof args.path === "string"
	) {
		return args.path;
	}
	return truncate(JSON.stringify(args), TOOL_ARG_DISPLAY_MAX);
}

export function debugPayloadLog(
	step: number,
	messages: Message[],
	system: string,
): { preSize: number; breakdown: string[] } {
	const preSize = totalPayloadSize(system, messages);
	const breakdown = messages
		.map((m, i) => {
			const s = messageSize(m);
			return s > 1000 ? `  [${i}] ${m.role} ${(s / 1024).toFixed(1)}KB` : null;
		})
		.filter((line): line is string => line !== null);
	return { preSize, breakdown };
}
