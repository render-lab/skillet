/**
 * Build-time constant injected by tsup `define` (see tsup.config.ts).
 * In dev mode (pnpm dev), falls back to npm_package_version set by the package manager.
 */
declare const SKILL_EVAL_VERSION: string;

export const VERSION: string =
	typeof SKILL_EVAL_VERSION !== "undefined"
		? SKILL_EVAL_VERSION
		: (process.env.npm_package_version ?? "0.0.0");
