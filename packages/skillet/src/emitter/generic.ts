import path from "node:path";
import { writeText } from "../utils/fs.js";
import type { EmitContext, EmitResult, Emitter } from "./base.js";
import { assembleMarkdown } from "./base.js";

export class GenericEmitter implements Emitter {
	target = "generic" as const;

	async emit(ctx: EmitContext): Promise<EmitResult> {
		const filePath = path.join(ctx.projectDir, "agent-context.md");
		const content = assembleMarkdown(ctx);
		await writeText(filePath, content);
		return { target: this.target, files: [filePath] };
	}
}
