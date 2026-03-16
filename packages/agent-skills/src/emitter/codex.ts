import { mkdir } from "node:fs/promises";
import path from "node:path";
import { renderFrontmatter } from "../utils/frontmatter.js";
import { writeText } from "../utils/fs.js";
import type { EmitContext, EmitResult, Emitter } from "./base.js";
import { renderSkill } from "./base.js";

/**
 * Codex emitter: writes each skill as its own SKILL.md in .agents/skills/<name>/.
 */
export class CodexEmitter implements Emitter {
	target = "codex" as const;

	async emit(ctx: EmitContext): Promise<EmitResult> {
		const files: string[] = [];

		for (const skill of ctx.skills) {
			const skillDir = path.join(ctx.projectDir, ".agents", "skills", skill.frontmatter.name);
			await mkdir(skillDir, { recursive: true });

			const filePath = path.join(skillDir, "SKILL.md");
			const fm: Record<string, unknown> = {
				name: skill.frontmatter.name,
				description: skill.frontmatter.description,
			};
			const body = renderSkill(skill, ctx.strategy);
			const content = renderFrontmatter(fm, body);
			await writeText(filePath, content);
			files.push(filePath);
		}

		return { target: this.target, files };
	}
}
