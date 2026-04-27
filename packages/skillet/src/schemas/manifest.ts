import { z } from "zod";

export const InjectionStrategy = z.enum(["eager", "lazy", "tiered"]);
export type InjectionStrategy = z.infer<typeof InjectionStrategy>;

export const TargetRuntime = z.enum([
	"cursor",
	"cursor-legacy",
	"claude-code",
	"codex",
	"windsurf",
	"cline",
	"generic",
]);
export type TargetRuntime = z.infer<typeof TargetRuntime>;
export const TARGET_RUNTIMES = TargetRuntime.options;

export const SkillInjectOverride = z.enum(["eager", "lazy"]);

export const SkillEntry = z.union([
	z.string(),
	z.object({
		version: z.string(),
		inject: SkillInjectOverride.optional(),
	}),
]);
export type SkillEntry = z.infer<typeof SkillEntry>;

export const ManifestConfig = z.object({
	target: z.array(TargetRuntime).default(["cursor", "claude-code"]),
	inject: InjectionStrategy.default("eager"),
});
export type ManifestConfig = z.infer<typeof ManifestConfig>;

export const ManifestSchema = z.object({
	name: z.string(),
	version: z.string().default("1.0.0"),
	skills: z.record(z.string(), SkillEntry).default({}),
	config: ManifestConfig.default({}),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const MANIFEST_FILE = "skills.json";
