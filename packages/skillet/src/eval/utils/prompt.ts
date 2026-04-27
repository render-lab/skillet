import * as prompts from "@clack/prompts";

/** If the user cancelled the prompt, exit gracefully. Otherwise return the value. */
export function exitIfCancelled<T>(value: T | symbol): T {
	if (prompts.isCancel(value)) {
		prompts.cancel("Cancelled.");
		process.exit(0);
	}
	return value as T;
}
