import { exec, type ExecException } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ToolHandler } from "../providers/types.js";
import { extractErrorMessage } from "../utils/error.js";

export { defaultTools } from "./tool-defs.js";
export { collectOutputFiles, seedSandbox } from "./sandbox.js";

const MAX_OUTPUT_CHARS = 30_000;
const MAX_FILE_SIZE = 100 * 1024;
const MAX_BASH_TIMEOUT_MS = 30_000;

const INTERACTIVE_COMMAND_RULES: Array<{ pattern: RegExp; message: string }> = [
	{
		pattern: /\brender\s+logs\b[\s\S]*\s--tail(?:\s|$)/i,
		message:
			"`render logs --tail` streams indefinitely and is not supported in eval mode. Use a bounded logs command instead.",
	},
	{
		pattern: /\brender\s+psql(?:\s|$)/i,
		message:
			"`render psql` opens an interactive session and is not supported in eval mode. Use a non-interactive database query instead.",
	},
	{
		pattern: /\brender\s+ssh(?:\s|$)/i,
		message:
			"`render ssh` opens an interactive session and is not supported in eval mode. Use non-interactive inspection commands instead.",
	},
	{
		pattern: /\brender\s+login(?:\s|$)/i,
		message:
			"`render login` is interactive and is not supported in eval mode. Use preconfigured auth instead.",
	},
	{
		pattern: /\btail\s+-f(?:\s|$)/i,
		message: "`tail -f` streams indefinitely and is not supported in eval mode.",
	},
];

function truncateOutput(output: string): string {
	if (output.length <= MAX_OUTPUT_CHARS) return output;
	const half = Math.floor(MAX_OUTPUT_CHARS / 2);
	const removed = output.length - MAX_OUTPUT_CHARS;
	return `${output.slice(0, half)}\n\n... [${removed} characters truncated] ...\n\n${output.slice(-half)}`;
}

function safePath(sandboxDir: string, userPath: string): string {
	const resolved = path.resolve(sandboxDir, userPath);
	if (!resolved.startsWith(sandboxDir)) {
		throw new Error(`Path traversal blocked: ${userPath}`);
	}
	return resolved;
}

function effectiveBashTimeoutMs(evalTimeoutSeconds: number): number {
	return Math.min(Math.max(evalTimeoutSeconds * 1000, 1_000), MAX_BASH_TIMEOUT_MS);
}

function rejectInteractiveCommand(command: string): string | null {
	for (const rule of INTERACTIVE_COMMAND_RULES) {
		if (rule.pattern.test(command)) return rule.message;
	}
	return null;
}

function runBashCommand(
	command: string,
	sandboxDir: string,
	timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		exec(
			command,
			{
				cwd: sandboxDir,
				timeout: timeoutMs,
				maxBuffer: 1024 * 1024,
				encoding: "utf-8",
				env: { ...process.env, HOME: sandboxDir },
			},
			(error: ExecException | null, stdout: string, stderr: string) => {
				if (error) {
					const enriched = error as ExecException & {
						stdout?: string;
						stderr?: string;
					};
					enriched.stdout = stdout;
					enriched.stderr = stderr;
					reject(enriched);
					return;
				}
				resolve({ stdout, stderr });
			},
		);
	});
}

export function createToolHandlers(
	sandboxDir: string,
	timeout: number,
): Record<string, ToolHandler> {
	return {
		bash: async (args) => {
			const { command } = args as { command: string };
			const interactiveError = rejectInteractiveCommand(command);
			if (interactiveError) {
				return { error: interactiveError };
			}

			try {
				const { stdout } = await runBashCommand(
					command,
					sandboxDir,
					effectiveBashTimeoutMs(timeout),
				);
				return { stdout: truncateOutput(stdout.trim()) };
			} catch (err) {
				const e = err as { stdout?: string; stderr?: string; message?: string };
				const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
				const stdout = typeof e.stdout === "string" ? e.stdout.trim() : "";
				return { error: truncateOutput(stderr || stdout || e.message || "Command failed") };
			}
		},

		read_file: async (args) => {
			const { path: filePath } = args as { path: string };
			try {
				const resolved = safePath(sandboxDir, filePath);
				const stat = fs.statSync(resolved);
				if (stat.size > MAX_FILE_SIZE) {
					const sizeKB = Math.round(stat.size / 1024);
					return {
						error: `File is ${sizeKB}KB (limit: ${MAX_FILE_SIZE / 1024}KB). Use bash with head, tail, or grep to read specific parts.`,
					};
				}
				return { content: fs.readFileSync(resolved, "utf-8") };
			} catch (err) {
				return { error: extractErrorMessage(err) };
			}
		},

		write_file: async (args) => {
			const { path: filePath, content } = args as { path: string; content: string };
			try {
				const resolved = safePath(sandboxDir, filePath);
				fs.mkdirSync(path.dirname(resolved), { recursive: true });
				fs.writeFileSync(resolved, content);
				return { success: true };
			} catch (err) {
				return { error: extractErrorMessage(err) };
			}
		},

		list_directory: async (args) => {
			const { path: dirPath } = args as { path: string };
			try {
				const resolved = safePath(sandboxDir, dirPath || ".");
				const entries = fs.readdirSync(resolved, { withFileTypes: true });
				return {
					entries: entries.map((e) => ({
						name: e.name,
						type: e.isDirectory() ? "directory" : "file",
					})),
				};
			} catch (err) {
				return { error: extractErrorMessage(err) };
			}
		},
	};
}
