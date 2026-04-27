import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import pc from "picocolors";
import { findProjectRoot, resolveSkillPaths } from "../config.js";
import { EVAL_UI_ASSET_BASE, getEvalUiDistDir, getEvalUiIndexPath } from "../report/ui-assets.js";
import type { BenchmarkFile } from "../schemas/benchmark.js";
import { exitWithMissingEvalsFile } from "../utils/cli-error.js";

interface ServeOpts {
	skill: string;
	evals?: string;
	port?: string;
}

interface ListenResult {
	port: number;
	fellBack: boolean;
}

const MIME: Record<string, string> = {
	".html": "text/html",
	".json": "application/json",
	".js": "application/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
};

export async function createServeServer(opts: ServeOpts) {
	const requestedPort = Number(opts.port ?? 3000);
	const paths = resolveSkillPaths(opts.skill, opts.evals);
	const skillArg = opts.skill || ".";
	const resultsRoot = path.join(findProjectRoot(paths.skillDir), ".skillet-evals", "results");
	const shouldServeAllSkills =
		!opts.evals && !fs.existsSync(paths.skillFile) && fs.existsSync(resultsRoot);
	const resultsDir = shouldServeAllSkills ? resultsRoot : paths.resultsDir;

	if (opts.evals && !fs.existsSync(paths.evalsFile)) {
		exitWithMissingEvalsFile("serve", skillArg, paths.evalsFile, true);
	}

	if (!fs.existsSync(resultsDir)) {
		fs.mkdirSync(resultsDir, { recursive: true });
	}

	const uiDistDir = getEvalUiDistDir();
	const uiIndexPath = getEvalUiIndexPath();

	let skillName = shouldServeAllSkills ? "All skills" : path.basename(paths.skillDir);
	if (!shouldServeAllSkills) {
		try {
			const raw = JSON.parse(fs.readFileSync(paths.evalsFile, "utf-8"));
			if (raw.skill_name) skillName = raw.skill_name;
		} catch {
			// evals.json may not exist yet; fall back to directory name
		}
	}

	function sendJson(res: http.ServerResponse, value: unknown, statusCode = 200) {
		res.writeHead(statusCode, {
			"Content-Type": "application/json",
			"Cache-Control": "no-cache",
		});
		res.end(JSON.stringify(value));
	}

	function sendText(res: http.ServerResponse, statusCode: number, message: string) {
		res.writeHead(statusCode, {
			"Content-Type": "text/plain",
			"Cache-Control": "no-cache",
		});
		res.end(message);
	}

	function sendFile(res: http.ServerResponse, filePath: string) {
		const ext = path.extname(filePath);
		res.writeHead(200, {
			"Content-Type": MIME[ext] ?? "application/octet-stream",
			"Cache-Control": ext === ".html" ? "no-cache" : "max-age=60",
		});
		fs.createReadStream(filePath).pipe(res);
	}

	function resolvePathUnder(baseDir: string, ...parts: string[]) {
		const resolved = path.resolve(baseDir, ...parts);
		return resolved.startsWith(path.resolve(baseDir)) ? resolved : null;
	}

	function getSkillIds() {
		if (!shouldServeAllSkills) {
			return [path.basename(resultsDir)];
		}

		if (!fs.existsSync(resultsDir)) return [];
		return fs
			.readdirSync(resultsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b));
	}

	function resolveSkillDir(skillId: string) {
		if (!skillId) return null;
		const allowedSkillIds = new Set(getSkillIds());
		if (!allowedSkillIds.has(skillId)) return null;
		return shouldServeAllSkills ? resolvePathUnder(resultsDir, skillId) : resultsDir;
	}

	function listRunFiles(skillId: string) {
		const skillDir = resolveSkillDir(skillId);
		if (!skillDir || !fs.existsSync(skillDir)) return [];
		return fs
			.readdirSync(skillDir)
			.filter((file) => file.endsWith(".json") && file !== "latest.json")
			.sort()
			.reverse();
	}

	function readBenchmark(skillId: string, fileName: string): BenchmarkFile | null {
		const skillDir = resolveSkillDir(skillId);
		if (!skillDir) return null;
		const filePath = resolvePathUnder(skillDir, fileName);
		if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as BenchmarkFile;
	}

	function summarizeRun(fileName: string, benchmark: BenchmarkFile) {
		const totalPassed = benchmark.runs.reduce((sum, run) => sum + (run.result?.passed ?? 0), 0);
		const totalAssertions = benchmark.runs.reduce((sum, run) => sum + (run.result?.total ?? 0), 0);
		return {
			file: fileName,
			metadata: benchmark.metadata,
			providerSummary: benchmark.provider_summary,
			passRate: totalAssertions > 0 ? totalPassed / totalAssertions : 0,
			totalPassed,
			totalAssertions,
		};
	}

	function buildSkillSummary(skillId: string) {
		const runFiles = listRunFiles(skillId);
		const latestRunFile = runFiles[0] ?? null;
		const latestBenchmark = latestRunFile ? readBenchmark(skillId, latestRunFile) : null;
		const latestSummary = latestBenchmark ? summarizeRun(latestRunFile, latestBenchmark) : null;
		return {
			id: skillId,
			name: latestBenchmark?.metadata.skill_name ?? skillId,
			runCount: runFiles.length,
			latestRunFile,
			latestTimestamp: latestBenchmark?.metadata.timestamp ?? null,
			latestPassRate: latestSummary?.passRate ?? 0,
			latestProviderCount: Object.keys(latestBenchmark?.provider_summary ?? {}).length,
		};
	}

	function readRunSummaries(skillId: string) {
		return listRunFiles(skillId)
			.map((fileName) => {
				const benchmark = readBenchmark(skillId, fileName);
				return benchmark ? summarizeRun(fileName, benchmark) : null;
			})
			.filter((summary): summary is NonNullable<typeof summary> => summary !== null);
	}

	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${requestedPort}`);
		const pathname = url.pathname;
		const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);

		if ((req.method ?? "GET") !== "GET") {
			sendText(res, 405, "Method not allowed");
			return;
		}

		if (pathname.startsWith(EVAL_UI_ASSET_BASE)) {
			const assetPath = pathname.slice(EVAL_UI_ASSET_BASE.length);
			const resolvedPath = resolvePathUnder(uiDistDir, assetPath);
			if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
				sendText(res, 404, "Not found");
				return;
			}
			sendFile(res, resolvedPath);
			return;
		}

		if (segments[0] === "api") {
			if (pathname === "/api/context") {
				sendJson(res, {
					mode: shouldServeAllSkills ? "all" : "single",
					skillId: shouldServeAllSkills ? undefined : path.basename(resultsDir),
					skillName: shouldServeAllSkills ? undefined : skillName,
				});
				return;
			}

			if (pathname === "/api/skills") {
				const skills = getSkillIds()
					.map((skillId) => buildSkillSummary(skillId))
					.filter((skill) => skill.runCount > 0)
					.sort((a, b) => {
						const aTime = a.latestTimestamp ?? "";
						const bTime = b.latestTimestamp ?? "";
						if (aTime === bTime) return a.name.localeCompare(b.name);
						return bTime.localeCompare(aTime);
					});
				sendJson(res, skills);
				return;
			}

			if (segments.length === 4 && segments[1] === "skills" && segments[3] === "runs") {
				const skillId = segments[2] ?? "";
				const summaries = readRunSummaries(skillId);
				if (!resolveSkillDir(skillId)) {
					sendText(res, 404, "Not found");
					return;
				}
				sendJson(res, summaries);
				return;
			}

			if (segments.length === 4 && segments[1] === "results") {
				const skillId = segments[2] ?? "";
				const fileName = segments[3] ?? "";
				const benchmark = readBenchmark(skillId, fileName);
				if (!benchmark) {
					sendText(res, 404, "Not found");
					return;
				}
				sendJson(res, benchmark);
				return;
			}

			sendText(res, 404, "Not found");
			return;
		}

		sendFile(res, uiIndexPath);
	});

	const { port: listeningPort, fellBack } = await listenWithPortFallback(server, requestedPort);

	console.log(pc.bold("\n  skillet eval serve\n"));
	console.log(`  Skill:    ${skillName}`);
	console.log(`  Results:  ${resultsDir}`);
	if (fellBack) {
		console.log(`  Port:     ${requestedPort} busy, using ${listeningPort}`);
	}
	console.log("");
	console.log(`  ${pc.green("→")} ${pc.bold(`http://localhost:${listeningPort}`)}`);
	console.log(`  ${pc.dim("Press Ctrl+C to stop")}\n`);

	return server;
}

export async function runServe(opts: ServeOpts): Promise<void> {
	await createServeServer(opts);
}

async function listenWithPortFallback(
	server: http.Server,
	requestedPort: number,
	maxAttempts = 20,
): Promise<ListenResult> {
	const normalizedPort = Number.isFinite(requestedPort) ? requestedPort : 3000;
	if (normalizedPort === 0) {
		await listenOnce(server, 0);
		return {
			port: getListeningPort(server, 0),
			fellBack: false,
		};
	}

	for (let offset = 0; offset <= maxAttempts; offset++) {
		const candidatePort = normalizedPort + offset;
		try {
			await listenOnce(server, candidatePort);
			return {
				port: getListeningPort(server, candidatePort),
				fellBack: offset > 0,
			};
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code !== "EADDRINUSE" || offset === maxAttempts) {
				throw error;
			}
		}
	}

	throw new Error(`Could not find an available port starting at ${normalizedPort}.`);
}

function listenOnce(server: http.Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: NodeJS.ErrnoException) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};

		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port);
	});
}

function getListeningPort(server: http.Server, fallbackPort: number) {
	const address = server.address();
	return typeof address === "object" && address ? address.port : fallbackPort;
}
