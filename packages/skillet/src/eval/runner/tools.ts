import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ToolHandler } from "../providers/types.js";
import { extractErrorMessage } from "../utils/error.js";

export { defaultTools } from "./tool-defs.js";
export { collectOutputFiles, seedSandbox } from "./sandbox.js";

const MAX_OUTPUT_CHARS = 30_000;
const MAX_FILE_SIZE = 100 * 1024;

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

export function createToolHandlers(
	sandboxDir: string,
	timeout: number,
): Record<string, ToolHandler> {
	return {
		bash: async (args) => {
			const { command } = args as { command: string };
			try {
				const output = execSync(command, {
					cwd: sandboxDir,
					timeout: timeout * 1000,
					maxBuffer: 1024 * 1024,
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
					env: { ...process.env, HOME: sandboxDir },
				});
				return { stdout: truncateOutput(output.trim()) };
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
