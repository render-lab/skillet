export interface Stats {
	mean: number;
	stddev: number;
}

export interface ProviderSummaryEntry {
	pass_rate: Stats;
	time_seconds: Stats;
	total_tokens: Stats;
	cost_usd: Stats;
}

export interface ProviderInfo {
	name: string;
	model: string;
}

export interface ExpectationResult {
	text: string;
	passed: boolean;
	evidence: string;
}

export interface RunResult {
	pass_rate: number;
	passed: number;
	failed: number;
	total: number;
	time_seconds: number;
	input_tokens?: number;
	output_tokens?: number;
	total_tokens: number;
	tool_calls?: number;
	errors?: number;
	cost_usd: number;
}

export interface BenchmarkRun {
	eval_id: number;
	provider: string;
	model: string;
	run_number: number;
	result: RunResult;
	expectations: ExpectationResult[];
	claims?: string[];
	eval_feedback?: string | null;
	error?: string | null;
}

export interface BenchmarkFile {
	metadata: {
		skill_name: string;
		skill_path?: string;
		skill_version?: string;
		skill_sha256?: string;
		timestamp: string;
		evals_run?: number[];
		runs_per_provider?: number;
		providers?: ProviderInfo[];
		grader?: ProviderInfo;
	};
	runs: BenchmarkRun[];
	provider_summary: Record<string, ProviderSummaryEntry>;
	notes?: string[];
}

export interface EvalContext {
	mode: "all" | "single";
	skillId?: string;
	skillName?: string;
}

export interface SkillSummary {
	id: string;
	name: string;
	runCount: number;
	latestRunFile: string | null;
	latestTimestamp: string | null;
	latestPassRate: number;
	latestProviderCount: number;
}

export interface RunSummary {
	file: string;
	metadata: BenchmarkFile["metadata"];
	providerSummary: BenchmarkFile["provider_summary"];
	passRate: number;
	totalPassed: number;
	totalAssertions: number;
}
