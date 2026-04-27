import { runFixtures } from "./fixtures.js";
import { runGenerate } from "./generate.js";

interface ScaffoldOpts {
	skills?: string[];
	count?: string;
	config?: string;
	evals?: string;
}

export async function runScaffold(opts: ScaffoldOpts) {
	await runGenerate({ skills: opts.skills, count: opts.count, config: opts.config });
	await runFixtures({ skills: opts.skills, evals: opts.evals, config: opts.config });
}
