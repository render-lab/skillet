import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { uiState } = vi.hoisted(() => ({
	uiState: {
		dir: "",
	},
}));

vi.mock("../../src/eval/report/ui-assets.js", () => ({
	EVAL_UI_ASSET_BASE: "/__skillet-eval-ui/",
	getEvalUiDistDir: () => uiState.dir,
	getEvalUiIndexPath: () => path.join(uiState.dir, "index.html"),
}));

import { createServeServer } from "../../src/eval/commands/serve.js";

function makeBenchmark(skillName: string, timestamp = "2026-04-27T12:00:00.000Z") {
	return {
		metadata: {
			skill_name: skillName,
			timestamp,
			skill_version: "1.0.0",
			skill_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		},
		provider_summary: {
			"gpt-5.4": {
				pass_rate: { mean: 1, stddev: 0 },
				time_seconds: { mean: 0.5, stddev: 0 },
				total_tokens: { mean: 15, stddev: 0 },
				cost_usd: { mean: 0.001, stddev: 0 },
			},
		},
		runs: [
			{
				eval_id: 1,
				model: "gpt-5.4",
				run_number: 1,
				result: {
					pass_rate: 1,
					passed: 1,
					failed: 0,
					total: 1,
					time_seconds: 0.5,
					total_tokens: 15,
					cost_usd: 0.001,
				},
				expectations: [{ text: "does the task", passed: true, evidence: "done" }],
				eval_feedback: null,
				error: null,
			},
		],
	};
}

describe("runServe", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(tmpdir(), "skillet-serve-"));
		uiState.dir = path.join(tmpDir, "ui");
		originalCwd = process.cwd();
		process.chdir(tmpDir);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await writeFile(path.join(tmpDir, "package.json"), '{ "name": "test-project" }\n');
		await mkdir(uiState.dir, { recursive: true });
		await writeFile(
			path.join(uiState.dir, "index.html"),
			"<!doctype html><html><body>eval-ui</body></html>",
		);
		await writeFile(path.join(uiState.dir, "app.js"), 'console.log("eval-ui");\n');
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		process.chdir(originalCwd);
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("serves the SPA and JSON APIs in multi-skill mode", async () => {
		const resultsRoot = path.join(tmpDir, ".skillet-evals", "results");
		const skillADir = path.join(resultsRoot, "skill-a");
		const skillBDir = path.join(resultsRoot, "skill-b");
		await mkdir(skillADir, { recursive: true });
		await mkdir(skillBDir, { recursive: true });
		await writeFile(
			path.join(skillADir, "2026-04-27T12-00-00.json"),
			`${JSON.stringify(makeBenchmark("skill-a", "2026-04-27T12:00:00.000Z"))}\n`,
		);
		await writeFile(
			path.join(skillBDir, "2026-04-27T12-05-00.json"),
			`${JSON.stringify(makeBenchmark("skill-b", "2026-04-27T12:05:00.000Z"))}\n`,
		);

		const server = await createServeServer({ skill: tmpDir, port: "0" });
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected server to listen on a TCP port");
		}
		const baseUrl = `http://127.0.0.1:${address.port}`;

		try {
			const context = await fetch(`${baseUrl}/api/context`).then((res) => res.json());
			expect(context).toEqual({ mode: "all" });

			const skills = await fetch(`${baseUrl}/api/skills`).then((res) => res.json());
			expect(skills).toEqual([
				{
					id: "skill-b",
					name: "skill-b",
					runCount: 1,
					latestRunFile: "2026-04-27T12-05-00.json",
					latestTimestamp: "2026-04-27T12:05:00.000Z",
					latestPassRate: 1,
					latestProviderCount: 1,
				},
				{
					id: "skill-a",
					name: "skill-a",
					runCount: 1,
					latestRunFile: "2026-04-27T12-00-00.json",
					latestTimestamp: "2026-04-27T12:00:00.000Z",
					latestPassRate: 1,
					latestProviderCount: 1,
				},
			]);

			const skillRuns = await fetch(`${baseUrl}/api/skills/skill-a/runs`).then((res) => res.json());
			expect(skillRuns).toHaveLength(1);
			expect(skillRuns[0].file).toBe("2026-04-27T12-00-00.json");

			const rawRun = await fetch(`${baseUrl}/api/results/skill-b/2026-04-27T12-05-00.json`).then(
				(res) => res.json(),
			);
			expect(rawRun.metadata.skill_name).toBe("skill-b");

			const rootPage = await fetch(`${baseUrl}/`).then((res) => res.text());
			expect(rootPage).toContain("eval-ui");

			const skillPage = await fetch(`${baseUrl}/skills/skill-a`);
			expect(skillPage.status).toBe(200);
			expect(await skillPage.text()).toContain("eval-ui");

			const assetResponse = await fetch(`${baseUrl}/__skillet-eval-ui/app.js`);
			expect(assetResponse.status).toBe(200);
			expect(await assetResponse.text()).toContain("eval-ui");
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			});
		}
	});

	it("falls back to the next available port when the requested one is busy", async () => {
		const blocker = http.createServer((_req, res) => {
			res.writeHead(200);
			res.end("busy");
		});

		await new Promise<void>((resolve) => {
			blocker.listen(0, resolve);
		});
		const blockerAddress = blocker.address();
		if (!blockerAddress || typeof blockerAddress === "string") {
			throw new Error("Expected blocker to listen on a TCP port");
		}

		const resultsRoot = path.join(tmpDir, ".skillet-evals", "results");
		const skillADir = path.join(resultsRoot, "skill-a");
		await mkdir(skillADir, { recursive: true });
		await writeFile(
			path.join(skillADir, "2026-04-27T12-00-00.json"),
			`${JSON.stringify(makeBenchmark("skill-a", "2026-04-27T12:00:00.000Z"))}\n`,
		);

		let server: http.Server | null = null;
		try {
			server = await createServeServer({
				skill: tmpDir,
				port: String(blockerAddress.port),
			});
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("Expected eval server to listen on a TCP port");
			}
			expect(address.port).toBe(blockerAddress.port + 1);
		} finally {
			await new Promise<void>((resolve, reject) => {
				blocker.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			});
			if (server) {
				const activeServer = server;
				await new Promise<void>((resolve, reject) => {
					activeServer.close((error) => {
						if (error) reject(error);
						else resolve();
					});
				});
			}
		}
	});
});
