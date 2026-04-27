import pc from "picocolors";

function exampleSkillArg(skillArg: string) {
	return skillArg === "." ? "./path-to-skill" : skillArg;
}

export function formatMissingSkillFileMessage(
	command: string,
	skillArg: string,
	skillFile: string,
) {
	return [
		pc.red(`SKILL.md not found at ${skillFile}`),
		"",
		"Expected a skill directory containing SKILL.md.",
		"If you're not already in the right folder, pass the skill path explicitly:",
		`  ${pc.bold(`skillet eval ${command} ${exampleSkillArg(skillArg)}`)}`,
	].join("\n");
}

export function exitWithMissingSkillFile(
	command: string,
	skillArg: string,
	skillFile: string,
): never {
	console.error(formatMissingSkillFileMessage(command, skillArg, skillFile));
	process.exit(1);
}

export function formatMissingEvalsFileMessage(
	command: string,
	skillArg: string,
	evalsFile: string,
	explicitPath = false,
) {
	if (explicitPath) {
		return [
			pc.red(`evals.json not found at ${evalsFile}`),
			"",
			"Check the path you passed with --evals, or omit it to use <skill>/evals.json.",
			`  ${pc.bold(`skillet eval ${command} ${exampleSkillArg(skillArg)}`)}`,
		].join("\n");
	}

	return [
		pc.red(`evals.json not found at ${evalsFile}`),
		"",
		"Create evals.json first, or point to an existing file with --evals.",
		`  ${pc.bold(`skillet eval generate ${exampleSkillArg(skillArg)}`)}`,
		`  ${pc.bold(`skillet eval ${command} ${exampleSkillArg(skillArg)} --evals path/to/evals.json`)}`,
	].join("\n");
}

export function exitWithMissingEvalsFile(
	command: string,
	skillArg: string,
	evalsFile: string,
	explicitPath = false,
): never {
	console.error(formatMissingEvalsFileMessage(command, skillArg, evalsFile, explicitPath));
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
