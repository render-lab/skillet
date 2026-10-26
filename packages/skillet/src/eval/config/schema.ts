import { z } from "zod";

export const ProviderConfigSchema = z.object({
	name: z.enum(["anthropic", "openai", "google"]),
	model: z.string(),
	apiKey: z.string().optional(),
});

export const GraderConfigSchema = z.object({
	provider: z.enum(["anthropic", "openai", "google"]),
	model: z.string(),
});

export const SkillDiscoveryConfigSchema = z.object({
	roots: z.array(z.string()).default([]),
});

const MockExposeSchema = z.enum(["http", "tools"]);

export const MockToolConfigSchema = z.object({
	name: z.string(),
	description: z.string().default("Mock tool"),
	parameters: z.record(z.unknown()).optional(),
	response: z.unknown().optional(),
	responseFromState: z.string().optional(),
});

export const MockConfigSchema = z.object({
	openapi: z.union([z.string(), z.array(z.string())]).optional(),
	mcpServer: z.union([z.string(), z.array(z.string())]).optional(),
	expose: z.array(MockExposeSchema).default(["http", "tools"]),
	tools: z.array(MockToolConfigSchema).default([]),
});

const ProviderEntrySchema = z.union([z.string(), ProviderConfigSchema]);

// Patterns are repository-relative. Matching/consumer validation happens in changed mode.
export const ChangesConfigSchema = z
	.object({
		global: z.array(z.string().min(1)).default([]),
		ignore: z.array(z.string().min(1)).default([]),
		dependencies: z
			.array(
				z
					.object({
						paths: z.array(z.string().min(1)).min(1),
						skills: z.array(z.string().min(1)).min(1),
					})
					.strict(),
			)
			.default([]),
	})
	.strict();

export const ConfigFileSchema = z.object({
	providers: z.array(ProviderEntrySchema).min(1),
	changes: ChangesConfigSchema.optional(),
	grader: GraderConfigSchema.optional(),
	skills: SkillDiscoveryConfigSchema.default({}),
	mocks: z.record(MockConfigSchema).default({}),
	settings: z
		.object({
			maxSteps: z.number().int().positive().default(20),
			timeout: z.number().positive().default(300),
			runsPerProvider: z.number().int().positive().default(1),
			temperature: z.number().min(0).max(2).optional(),
		})
		.default({}),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type GraderConfig = z.infer<typeof GraderConfigSchema>;
export type SkillDiscoveryConfig = z.infer<typeof SkillDiscoveryConfigSchema>;
export type MockToolConfig = z.infer<typeof MockToolConfigSchema>;
export type MockConfig = z.infer<typeof MockConfigSchema>;
export type Config = z.infer<typeof ConfigFileSchema>;

export interface ResolvedConfig {
	providers: Array<ProviderConfig & { apiKey: string }>;
	grader: GraderConfig & { apiKey: string };
	skillRoots: string[];
	settings: Config["settings"];
	mocks: Record<string, MockConfig>;
}

export interface CliOverrides {
	configPath?: string;
	providers?: string[];
	models?: string[];
	runs?: number;
	timeout?: number;
	concurrency?: number;
}
