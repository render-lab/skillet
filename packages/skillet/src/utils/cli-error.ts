import pc from "picocolors";

function printHintLines(lines: string[]) {
	for (const line of lines) {
		console.error(line);
	}
}

export function exitWithMissingManifest(action: string): never {
	console.error(pc.red("skills.json not found in the current directory."));
	console.error("");
	printHintLines([
		"Initialize a Skillet project first:",
		`  ${pc.bold("skillet init")}`,
		action ? `Then run:` : "",
		action ? `  ${pc.bold(action)}` : "",
	].filter(Boolean));
	process.exit(1);
}

export function exitWithMissingLockfile(action: string): never {
	console.error(pc.red("skills.lock not found in the current directory."));
	console.error("");
	printHintLines([
		"Install your declared skills first:",
		`  ${pc.bold("skillet install")}`,
		action ? `Then run:` : "",
		action ? `  ${pc.bold(action)}` : "",
	].filter(Boolean));
	process.exit(1);
}

export function exitWithNoSkillsDeclared(): never {
	console.error(pc.yellow("No skills declared in skills.json."));
	console.error("");
	printHintLines([
		"Add at least one skill first:",
		`  ${pc.bold("skillet add owner/repo/skills/my-skill")}`,
	]);
	process.exit(1);
}

export function exitWithUnknownEmitTarget(target: string, validTargets: string[]): never {
	console.error(pc.red(`Unknown emit target: ${target}`));
	console.error("");
	printHintLines([
		`Valid targets: ${validTargets.join(", ")}`,
		`Example: ${pc.bold("skillet emit --target cursor,claude-code")}`,
	]);
	process.exit(1);
}
