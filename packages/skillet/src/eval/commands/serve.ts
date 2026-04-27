import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import pc from "picocolors";
import { resolveSkillPaths } from "../config.js";
import { writeDashboard } from "../report/html-reporter.js";

interface ServeOpts {
	skill: string;
	evals?: string;
	port?: string;
}

const MIME: Record<string, string> = {
	".html": "text/html",
	".json": "application/json",
	".js": "application/javascript",
	".css": "text/css",
};

export async function runServe(opts: ServeOpts) {
	const port = Number(opts.port ?? 3000);
	const paths = resolveSkillPaths(opts.skill, opts.evals);
	const resultsDir = paths.resultsDir;

	if (!fs.existsSync(resultsDir)) {
		fs.mkdirSync(resultsDir, { recursive: true });
	}

	writeDashboard(resultsDir);

	let skillName = path.basename(paths.skillDir);
	try {
		const raw = JSON.parse(fs.readFileSync(paths.evalsFile, "utf-8"));
		if (raw.skill_name) skillName = raw.skill_name;
	} catch {
		// evals.json may not exist yet; fall back to directory name
	}

	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${port}`);
		const pathname = url.pathname;

		if (pathname === "/api/runs") {
			const files = fs
				.readdirSync(resultsDir)
				.filter((f) => f.endsWith(".json") && f !== "latest.json")
				.sort()
				.reverse();
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-cache",
			});
			res.end(JSON.stringify(files));
			return;
		}

		let filePath: string;
		if (pathname === "/" || pathname === "/index.html") {
			writeDashboard(resultsDir);
			filePath = path.join(resultsDir, "index.html");
		} else {
			const safeName = path.basename(pathname);
			filePath = path.join(resultsDir, safeName);
		}

		if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
			const ext = path.extname(filePath);
			res.writeHead(200, {
				"Content-Type": MIME[ext] ?? "text/plain",
				"Cache-Control": ext === ".json" ? "no-cache" : "max-age=60",
			});
			fs.createReadStream(filePath).pipe(res);
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not found");
	});

	server.listen(port, () => {
		console.log(pc.bold("\n  skillet eval serve\n"));
		console.log(`  Skill:    ${skillName}`);
		console.log(`  Results:  ${resultsDir}`);
		console.log("");
		console.log(`  ${pc.green("→")} ${pc.bold(`http://localhost:${port}`)}`);
		console.log(`  ${pc.dim("Press Ctrl+C to stop")}\n`);
	});
}
