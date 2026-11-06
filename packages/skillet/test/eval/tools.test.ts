import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createToolHandlers } from "../../src/eval/runner/tools.js";

describe("createToolHandlers", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
		dirs.length = 0;
		vi.unstubAllEnvs();
	});

	it("keeps secrets and shell startup hooks out of commands while retaining executable lookup", async () => {
		const sandboxDir = await mkdtemp(path.join(tmpdir(), "skillet-env-"));
		dirs.push(sandboxDir);
		for (const key of [
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
			"GOOGLE_API_KEY",
			"GITHUB_TOKEN",
			"AWS_SECRET_ACCESS_KEY",
			"CUSTOM_SECRET",
			"HTTPS_PROXY",
			"NODE_OPTIONS",
			"BASH_ENV",
		]) {
			vi.stubEnv(key, "skillet-secret-sentinel");
		}
		const output = await createToolHandlers(sandboxDir, 5).bash({
			command: `node -e 'console.log(JSON.stringify(process.env))'`,
		});
		expect(output).toHaveProperty("stdout");
		const env = JSON.parse((output as { stdout: string }).stdout);
		expect(JSON.stringify(env)).not.toContain("skillet-secret-sentinel");
		expect(env.HOME).toBe(sandboxDir);
		expect(env.XDG_CONFIG_HOME).toBe(path.join(sandboxDir, ".config"));
		expect(env.PATH).toBe(process.env.PATH);
		expect(process.env.OPENAI_API_KEY).toBe("skillet-secret-sentinel");
	});

	it("does not block the event loop while bash is running", async () => {
		const sandboxDir = await mkdtemp(path.join(tmpdir(), "skillet-tools-"));
		dirs.push(sandboxDir);
		const handlers = createToolHandlers(sandboxDir, 5);

		let timerFired = false;
		let commandResolved = false;

		const commandPromise = handlers
			.bash({
				command: `node -e "setTimeout(() => {}, 200)"`,
			})
			.then(() => {
				commandResolved = true;
			});

		setTimeout(() => {
			timerFired = true;
		}, 50);

		await new Promise((resolve) => setTimeout(resolve, 75));

		expect(timerFired).toBe(true);
		expect(commandResolved).toBe(false);

		await commandPromise;
	});

	it("rejects interactive render CLI commands before execution", async () => {
		const sandboxDir = await mkdtemp(path.join(tmpdir(), "skillet-tools-"));
		dirs.push(sandboxDir);
		const handlers = createToolHandlers(sandboxDir, 5);

		await expect(
			handlers.bash({
				command: "render ssh svc-123",
			}),
		).resolves.toEqual({
			error:
				"`render ssh` opens an interactive session and is not supported in eval mode. Use non-interactive inspection commands instead.",
		});

		await expect(
			handlers.bash({
				command: "render logs -r svc-123 --tail -o text",
			}),
		).resolves.toEqual({
			error:
				"`render logs --tail` streams indefinitely and is not supported in eval mode. Use a bounded logs command instead.",
		});
	});
});
