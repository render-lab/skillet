import { runFixtures } from "./fixtures.js";
import { runGenerate } from "./generate.js";

interface ScaffoldOpts {
	skill: string;
	count?: string;
	config?: string;
	evals?: string;
}

export async function runScaffold(opts: ScaffoldOpts) {
	await runGenerate({ skill: opts.skill, count: opts.count, config: opts.config });
	await runFixtures({ skill: opts.skill, evals: opts.evals, config: opts.config });
}
