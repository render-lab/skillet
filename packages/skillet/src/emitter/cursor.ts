import { mkdir } from "node:fs/promises";
import path from "node:path";
import { writeText } from "../utils/fs.js";
import type { EmitContext, EmitResult, Emitter, SkillContent } from "./base.js";
import { assembleMarkdown, renderSkill } from "./base.js";

/**
 * Modern Cursor emitter: writes one .mdc file per skill into .cursor/rules/.
 */
export class CursorEmitter implements Emitter {
	target = "cursor" as const;

	async emit(ctx: EmitContext): Promise<EmitResult> {
		const rulesDir = path.join(ctx.projectDir, ".cursor", "rules");
		await mkdir(rulesDir, { recursive: true });

		const files: string[] = [];

		for (const skill of ctx.skills) {
			const filename = `${skill.frontmatter.name}.mdc`;
			const filePath = path.join(rulesDir, filename);

			const content = buildMdcFile(skill, ctx.strategy);
			await writeText(filePath, content);
			files.push(filePath);
		}

		return { target: this.target, files };
	}
}

function buildMdcFile(skill: SkillContent, strategy: EmitContext["strategy"]): string {
	const body = renderSkill(skill, strategy);
	const frontmatter = [
		"---",
		`description: ${skill.frontmatter.description}`,
		"alwaysApply: true",
		"---",
	].join("\n");
	return `${frontmatter}\n${body}\n`;
}

/**
 * Legacy Cursor emitter: writes a single .cursorrules file.
 */
export class CursorLegacyEmitter implements Emitter {
	target = "cursor-legacy" as const;

	async emit(ctx: EmitContext): Promise<EmitResult> {
		const filePath = path.join(ctx.projectDir, ".cursorrules");
		const content = assembleMarkdown(ctx);
		await writeText(filePath, content);
		return { target: this.target, files: [filePath] };
	}
}
