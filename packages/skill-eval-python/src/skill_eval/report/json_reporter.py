from __future__ import annotations

from datetime import datetime
from pathlib import Path

from skill_eval.config.schema import ResolvedConfig
from skill_eval.schemas.benchmark import (
    BenchmarkFile,
    BenchmarkMetadata,
    ProviderInfo,
    ProviderSummary,
)


def write_benchmark_json(
    result: dict,
    config: ResolvedConfig,
    meta: dict,
    output_path: str,
) -> str:
    provider_summary_raw = result.get("provider_summary") or result.get("providerSummary") or {}
    provider_summary = {
        k: ProviderSummary.model_validate(v) for k, v in provider_summary_raw.items()
    }

    benchmark = BenchmarkFile(
        metadata=BenchmarkMetadata(
            skill_name=meta["skill_name"],
            skill_path=meta["skill_path"],
            timestamp=datetime.now().isoformat(),
            evals_run=meta["evals_run"],
            runs_per_provider=config.settings.runs_per_provider,
            providers=[
                ProviderInfo(name=p.name, model=p.model) for p in config.providers
            ],
            grader=ProviderInfo(
                name=config.grader.provider,
                model=config.grader.model,
            ),
        ),
        runs=result["runs"],
        provider_summary=provider_summary,
        notes=[],
    )

    Path(output_path).write_text(
        benchmark.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )
    return output_path
