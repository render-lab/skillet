import fs from "node:fs";
import pc from "picocolors";
import { loadConfig, resolveSkillPaths } from "../config.js";
import { EvalsFileSchema } from "../schemas/evals.js";
import { extractErrorMessage } from "../utils/error.js";

interface ValidateOpts {
	skills: string[];
	evals?: string;
	config?: string;
}

export async function runValidate(opts: ValidateOpts) {
	let hasError = false;
	const multipleSkills = opts.skills.length > 1;

	if (multipleSkills && opts.evals) {
		throw new Error("--evals can only be used when validating a single skill.");
	}

	function pass(msg: string) {
		console.log(`  ${pc.green("✓")} ${msg}`);
	}
	function fail(msg: string) {
		console.log(`  ${pc.red("✗")} ${msg}`);
		hasError = true;
	}

	console.log(pc.bold("\nSkill Eval — Validate\n"));

	for (const [index, skill] of opts.skills.entries()) {
		if (multipleSkills) {
			if (index > 0) console.log("");
			console.log(pc.bold(`Skill: ${skill}`));
		}

		const paths = resolveSkillPaths(skill, opts.evals);

		if (fs.existsSync(paths.skillDir) && fs.statSync(paths.skillDir).isDirectory()) {
			pass(`Skill directory: ${paths.skillDir}`);
		} else {
			fail(`Skill directory not found: ${paths.skillDir}`);
		}

		if (fs.existsSync(paths.skillFile)) {
			const size = fs.statSync(paths.skillFile).size;
			pass(`SKILL.md found (${(size / 1024).toFixed(1)} KB)`);
		} else {
			fail(
				`SKILL.md not found at ${paths.skillFile}. Pass the skill directory explicitly if you're not already in it.`,
			);
		}

		if (fs.existsSync(paths.evalsFile)) {
			try {
				const raw = JSON.parse(fs.readFileSync(paths.evalsFile, "utf-8"));
				const parsed = EvalsFileSchema.parse(raw);
				const totalAssertions = parsed.evals.reduce((sum, e) => sum + e.assertions.length, 0);
				pass(`evals.json valid (${parsed.evals.length} evals, ${totalAssertions} assertions)`);
			} catch (err) {
				fail(`evals.json invalid: ${extractErrorMessage(err)}`);
			}
		} else {
			fail(
				`evals.json not found at ${paths.evalsFile}. Run "skillet eval generate ${skill}" or pass --evals <path>.`,
			);
		}

		try {
			const config = loadConfig({ configPath: opts.config });
			for (const p of config.providers) {
				pass(`${p.model}: API key valid`);
			}
		} catch (err) {
			fail(`Config: ${extractErrorMessage(err)}`);
		}
	}

	console.log("");

	if (hasError) {
		console.log(pc.red("Validation found issues. Fix them before running evals.\n"));
		process.exit(1);
	} else {
		console.log(pc.green("All checks passed. Ready to run evals.\n"));
	}
}
