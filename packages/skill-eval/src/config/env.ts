import fs from "node:fs";
import path from "node:path";
import { ENV_KEY_MAP } from "./registry.js";

function interpolateEnvVars(value: string): string {
	return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

export function resolveApiKey(providerName: string, explicitKey?: string): string | undefined {
	if (explicitKey) {
		const interpolated = interpolateEnvVars(explicitKey);
		if (interpolated) return interpolated;
	}
	const envNames = ENV_KEY_MAP[providerName] ?? [];
	for (const envName of envNames) {
		const val = process.env[envName];
		if (val) return val;
	}
	return undefined;
}

/**
 * Load .env files into process.env. Existing env vars take precedence.
 * For each starting directory, walks up to find the nearest .env file.
 */
export function loadDotenv(dirs: string[] = [process.cwd()]) {
	const loaded = new Set<string>();

	for (const startDir of dirs) {
		const envPath = findUp(".env", startDir);
		if (!envPath || loaded.has(envPath)) continue;
		loaded.add(envPath);
		parseEnvFile(envPath);
	}
}

function findUp(filename: string, startDir: string): string | null {
	let dir = path.resolve(startDir);
	while (true) {
		const candidate = path.join(dir, filename);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function parseEnvFile(envPath: string) {
	let content: string;
	try {
		content = fs.readFileSync(envPath, "utf-8");
	} catch {
		return;
	}

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;

		const key = trimmed.slice(0, eqIdx).trim();
		let value = trimmed.slice(eqIdx + 1).trim();

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		if (key && process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}
