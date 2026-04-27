import { z } from "zod";

export const ResolvedEntry = z.object({
	sha256: z.string(),
	source: z.string(),
	commitSha: z.string(),
	evalScore: z.number().optional(),
	evalModel: z.string().optional(),
	behavioralContract: z.string().optional(),
});
export type ResolvedEntry = z.infer<typeof ResolvedEntry>;

export const LockfileSchema = z.object({
	lockfileVersion: z.literal(1),
	model: z.string().optional(),
	resolved: z.record(z.string(), ResolvedEntry),
});
export type Lockfile = z.infer<typeof LockfileSchema>;

export const LOCKFILE_NAME = "skills.lock";
