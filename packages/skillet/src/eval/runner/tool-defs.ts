import { z } from "zod";
import type { ToolDefinition } from "../providers/types.js";

export const defaultTools: ToolDefinition[] = [
	{
		name: "bash",
		description:
			"Run a bash command in the sandbox directory. Output is capped at 30KB. For large outputs, pipe through head, tail, or grep.",
		parameters: z.object({
			command: z.string(),
		}),
	},
	{
		name: "read_file",
		description:
			"Read the contents of a file. Files over 100KB are rejected — use bash with head/tail/grep to read specific parts of large files.",
		parameters: z.object({
			path: z.string(),
		}),
	},
	{
		name: "write_file",
		description: "Write content to a file (creates parent directories if needed)",
		parameters: z.object({
			path: z.string(),
			content: z.string(),
		}),
	},
	{
		name: "list_directory",
		description: "List files and directories at the given path",
		parameters: z.object({
			path: z.string(),
		}),
	},
];
