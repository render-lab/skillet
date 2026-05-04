import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import YAML from "yaml";
import { buildMockManifest, mockManifestRoot } from "../runner/mocks.js";

export interface MockImportOpts {
	kind: "openapi" | "mcp";
	source: string;
	name?: string;
	config?: string;
}

const DEFAULT_CONFIG_PATH = "skillet.config.yaml";

function isUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

/** Strip extensions and trailing slashes to derive a friendly default mock name. */
function deriveMockName(source: string): string {
	let base: string;
	if (isUrl(source)) {
		try {
			const url = new URL(source);
			const segments = url.pathname.split("/").filter(Boolean);
			base = segments.length > 0 ? (segments[segments.length - 1] ?? url.hostname) : url.hostname;
		} catch {
			base = source;
		}
	} else {
		base = path.basename(source.replace(/\/+$/, ""));
	}
	return (
		base
			.replace(/\.(json|ya?ml|md)$/i, "")
			.replace(/[^a-zA-Z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "mock"
	);
}

function loadConfigDocument(configPath: string): YAML.Document {
	if (!fs.existsSync(configPath)) {
		return new YAML.Document({});
	}
	const raw = fs.readFileSync(configPath, "utf-8");
	if (!raw.trim()) return new YAML.Document({});
	const doc = YAML.parseDocument(raw);
	if (!doc.contents || !YAML.isMap(doc.contents)) {
		throw new Error(`${configPath} is not a YAML mapping at the top level.`);
	}
	return doc;
}

export async function runMockImport(opts: MockImportOpts): Promise<void> {
	if (opts.kind !== "openapi" && opts.kind !== "mcp") {
		throw new Error(`Unknown mock kind "${opts.kind}". Use "openapi" or "mcp".`);
	}

	const configPath = path.resolve(opts.config ?? DEFAULT_CONFIG_PATH);
	const name = opts.name?.trim() || deriveMockName(opts.source);
	if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
		throw new Error(
			`Mock name "${name}" is not valid. Use letters, numbers, underscores, or dashes (must start with a letter). Pass --name to override.`,
		);
	}

	const sourceForConfig = isUrl(opts.source)
		? opts.source
		: path.relative(path.dirname(configPath), path.resolve(opts.source)) || opts.source;
	const sourceForImport = isUrl(opts.source) ? opts.source : path.resolve(opts.source);

	const validatedMock = {
		expose: ["http", "tools"] as Array<"http" | "tools">,
		tools: [],
		...(opts.kind === "openapi" ? { openapi: sourceForImport } : { mcpServer: sourceForImport }),
	};

	const manifest = await buildMockManifest(name, validatedMock);

	const manifestRoot = mockManifestRoot();
	const manifestPath = path.join(manifestRoot, name, "manifest.json");
	fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

	const doc = loadConfigDocument(configPath);
	if (!doc.contents) doc.contents = doc.createNode({});
	const root = doc.contents as YAML.YAMLMap;

	let mocksNode = root.get("mocks") as YAML.YAMLMap | undefined;
	if (!mocksNode || !YAML.isMap(mocksNode)) {
		mocksNode = doc.createNode({}) as YAML.YAMLMap;
		root.set(doc.createNode("mocks"), mocksNode);
	}

	const newEntry: Record<string, unknown> = {};
	if (opts.kind === "openapi") {
		newEntry.openapi = sourceForConfig;
	} else {
		newEntry.mcpServer = sourceForConfig;
	}
	mocksNode.set(doc.createNode(name), doc.createNode(newEntry));

	fs.writeFileSync(configPath, doc.toString());

	const summary = [
		`${pc.green("✓")} Imported mock ${pc.bold(name)} from ${opts.source}`,
		`  config:   ${path.relative(process.cwd(), configPath) || configPath}`,
		`  manifest: ${path.relative(process.cwd(), manifestPath) || manifestPath}`,
	];
	if (manifest.errors.length > 0) {
		summary.push(`  ${pc.yellow("warnings:")}`);
		for (const error of manifest.errors) summary.push(`    - ${error}`);
	}
	console.log(summary.join("\n"));
}
