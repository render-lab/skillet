import path from "node:path";
import { writeText } from "../utils/fs.js";
import type { EmitContext, EmitResult, Emitter } from "./base.js";
import { assembleMarkdown } from "./base.js";

export class WindsurfEmitter implements Emitter {
	target = "windsurf" as const;

	async emit(ctx: EmitContext): Promise<EmitResult> {
		const filePath = path.join(ctx.projectDir, ".windsurfrules");
		const content = assembleMarkdown(ctx);
		await writeText(filePath, content);
		return { target: this.target, files: [filePath] };
	}
}
