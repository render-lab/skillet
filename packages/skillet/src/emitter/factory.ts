import type { TargetRuntime } from "../schemas/manifest.js";
import type { Emitter } from "./base.js";
import { ClaudeCodeEmitter } from "./claude-code.js";
import { ClineEmitter } from "./cline.js";
import { CodexEmitter } from "./codex.js";
import { CursorEmitter, CursorLegacyEmitter } from "./cursor.js";
import { GenericEmitter } from "./generic.js";
import { WindsurfEmitter } from "./windsurf.js";

const EMITTERS: Record<TargetRuntime, () => Emitter> = {
	cursor: () => new CursorEmitter(),
	"cursor-legacy": () => new CursorLegacyEmitter(),
	"claude-code": () => new ClaudeCodeEmitter(),
	codex: () => new CodexEmitter(),
	windsurf: () => new WindsurfEmitter(),
	cline: () => new ClineEmitter(),
	generic: () => new GenericEmitter(),
};

export function getEmitter(target: TargetRuntime): Emitter {
	const factory = EMITTERS[target];
	if (!factory) {
		throw new Error(`Unknown emit target: ${target}`);
	}
	return factory();
}

export function getEmitters(targets: TargetRuntime[]): Emitter[] {
	return targets.map(getEmitter);
}
