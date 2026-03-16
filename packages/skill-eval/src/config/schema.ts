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

export const ConfigFileSchema = z.object({
	providers: z.array(ProviderConfigSchema).min(1),
	grader: GraderConfigSchema.optional(),
	settings: z
		.object({
			maxSteps: z.number().int().positive().default(20),
			timeout: z.number().positive().default(300),
			runsPerProvider: z.number().int().positive().default(1),
			temperature: z.number().min(0).max(2).default(0),
		})
		.default({}),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type GraderConfig = z.infer<typeof GraderConfigSchema>;
export type Config = z.infer<typeof ConfigFileSchema>;

export interface ResolvedConfig {
	providers: Array<ProviderConfig & { apiKey: string }>;
	grader: GraderConfig & { apiKey: string };
	settings: Config["settings"];
}

export interface CliOverrides {
	configPath?: string;
	providers?: string[];
	models?: string[];
	runs?: number;
	timeout?: number;
	concurrency?: number;
}
