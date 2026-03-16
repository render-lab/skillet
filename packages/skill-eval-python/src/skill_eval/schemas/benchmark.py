from __future__ import annotations

from pydantic import BaseModel, Field

from skill_eval.schemas.grading import ExpectationResult


class ProviderInfo(BaseModel):
    name: str
    model: str


class Stats(BaseModel):
    mean: float
    stddev: float


class RunResult(BaseModel):
    pass_rate: float
    passed: int
    failed: int
    total: int
    time_seconds: float
    input_tokens: int
    output_tokens: int
    total_tokens: int
    tool_calls: int
    errors: int
    cost_usd: float


class BenchmarkRun(BaseModel):
    eval_id: int
    provider: str
    model: str
    run_number: int
    result: RunResult
    expectations: list[ExpectationResult]
    claims: list[str] = Field(default_factory=list)
    eval_feedback: str | None = None
    error: str | None = None


class BenchmarkMetadata(BaseModel):
    skill_name: str
    skill_path: str
    timestamp: str
    evals_run: list[int]
    runs_per_provider: int
    providers: list[ProviderInfo]
    grader: ProviderInfo


class ProviderSummary(BaseModel):
    pass_rate: Stats
    time_seconds: Stats
    total_tokens: Stats
    cost_usd: Stats


class BenchmarkFile(BaseModel):
    metadata: BenchmarkMetadata
    runs: list[BenchmarkRun]
    provider_summary: dict[str, ProviderSummary]
    notes: list[str] = Field(default_factory=list)
