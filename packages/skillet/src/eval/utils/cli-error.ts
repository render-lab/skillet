import pc from "picocolors";

function printHintLines(lines: string[]) {
	for (const line of lines) {
		console.error(line);
	}
}

function exampleSkillArg(skillArg: string) {
	return skillArg === "." ? "./path-to-skill" : skillArg;
}

export function exitWithMissingSkillFile(
	command: string,
	skillArg: string,
	skillFile: string,
): never {
	console.error(pc.red(`SKILL.md not found at ${skillFile}`));
	console.error("");
	printHintLines([
		"Expected a skill directory containing SKILL.md.",
		"If you're not already in the right folder, pass the skill path explicitly:",
		`  ${pc.bold(`skillet eval ${command} ${exampleSkillArg(skillArg)}`)}`,
	]);
	process.exit(1);
}

export function exitWithMissingEvalsFile(
	command: string,
	skillArg: string,
	evalsFile: string,
	explicitPath = false,
): never {
	console.error(pc.red(`evals.json not found at ${evalsFile}`));
	console.error("");
	if (explicitPath) {
		printHintLines([
			"Check the path you passed with --evals, or omit it to use <skill>/evals.json.",
			`  ${pc.bold(`skillet eval ${command} ${exampleSkillArg(skillArg)}`)}`,
		]);
	} else {
		printHintLines([
			"Create evals.json first, or point to an existing file with --evals.",
			`  ${pc.bold(`skillet eval generate ${exampleSkillArg(skillArg)}`)}`,
			`  ${pc.bold(`skillet eval ${command} ${exampleSkillArg(skillArg)} --evals path/to/evals.json`)}`,
		]);
	}
	process.exit(1);
}

export function exitWithMissingFile(label: string, filePath: string, nextStep?: string): never {
	console.error(pc.red(`${label} not found at ${filePath}`));
	if (nextStep) {
		console.error("");
		console.error(nextStep);
	}
	process.exit(1);
}
