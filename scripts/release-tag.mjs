#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliPackagePath = path.join(repoRoot, "packages", "skillet", "package.json");

function readPackageVersion() {
	const pkg = JSON.parse(fs.readFileSync(cliPackagePath, "utf8"));
	if (typeof pkg.version !== "string" || pkg.version.length === 0) {
		throw new Error(`No version found in ${cliPackagePath}`);
	}
	return pkg.version;
}

function runGit(args, options = {}) {
	const output = execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["inherit", "pipe", "pipe"],
		...options,
	});
	return typeof output === "string" ? output.trim() : "";
}

function runPnpm(args, options = {}) {
	execFileSync("pnpm", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: "inherit",
		...options,
	});
}

function gitRefExists(ref) {
	try {
		runGit(["rev-parse", "-q", "--verify", ref], { stdio: ["inherit", "pipe", "ignore"] });
		return true;
	} catch {
		return false;
	}
}

function printUsage() {
	console.log("Usage: pnpm release:tag [version]");
	console.log("");
	console.log("Creates an annotated tag and pushes it to origin.");
	console.log("If no version is provided, uses packages/skillet/package.json.");
	console.log("");
	console.log("Examples:");
	console.log("  pnpm release:tag");
	console.log("  pnpm release:tag 0.1.4");
	console.log("  pnpm release:tag v0.1.4");
}

try {
	const arg = process.argv[2];
	if (arg === "--help" || arg === "-h") {
		printUsage();
		process.exit(0);
	}

	const packageVersion = readPackageVersion();
	const resolvedVersion = arg ?? packageVersion;
	const tag = resolvedVersion.startsWith("v") ? resolvedVersion : `v${resolvedVersion}`;

	console.log("Running release preflight checks...");
	runPnpm(["check"]);
	runPnpm(["typecheck"]);
	runPnpm(["test"]);
	runPnpm(["--dir", "packages/skillet", "build"]);

	const dirty = runGit(["status", "--porcelain"]);
	if (dirty.length > 0) {
		console.error("Refusing to tag with uncommitted changes.");
		console.error("Commit or stash your changes, then rerun this command.");
		process.exit(1);
	}

	if (gitRefExists(`refs/tags/${tag}`)) {
		console.error(`Tag ${tag} already exists locally.`);
		process.exit(1);
	}

	const remoteTag = runGit(["ls-remote", "--tags", "origin", tag]);
	if (remoteTag.length > 0) {
		console.error(`Tag ${tag} already exists on origin.`);
		process.exit(1);
	}

	runGit(["tag", "-a", tag, "-m", `Release ${tag}`], { stdio: "inherit" });
	runGit(["push", "origin", tag], { stdio: "inherit" });

	console.log("");
	console.log(`Pushed ${tag} to origin.`);
	console.log("GitHub Actions will now create the release and upload the package tarball.");
	if (tag !== `v${packageVersion}`) {
		console.log(`Note: packages/skillet/package.json is still at ${packageVersion}.`);
	}
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exit(1);
}
