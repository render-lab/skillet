from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from rich.console import Console

from skill_eval.schemas.benchmark import BenchmarkFile, ProviderSummary
from skill_eval.utils.rate import rate_color


@dataclass
class CompareResult:
    provider: str
    golden_rate: float
    current_rate: float
    delta: float
    regressed: bool


def compare_benchmarks(
    golden: dict[str, ProviderSummary],
    current: dict[str, ProviderSummary],
) -> list[CompareResult]:
    """Pure comparison -- no I/O."""
    results: list[CompareResult] = []
    for provider, stats in golden.items():
        golden_rate = stats.pass_rate.mean
        current_entry = current.get(provider)
        current_rate = current_entry.pass_rate.mean if current_entry else 0.0
        delta = current_rate - golden_rate
        results.append(CompareResult(
            provider=provider,
            golden_rate=golden_rate,
            current_rate=current_rate,
            delta=delta,
            regressed=delta < 0,
        ))
    return results


def print_comparison(results: list[CompareResult], golden_path: str) -> bool:
    """Print a comparison table. Returns True if any provider regressed."""
    console = Console()
    console.print(f"\n  [bold]Regression check[/bold] [dim](vs {golden_path})[/dim]\n")

    for r in results:
        icon = "[red]✗[/red]" if r.regressed else "[green]✓[/green]"
        color = rate_color(r.current_rate)
        pct = lambda v: f"{v * 100:.0f}%"
        sign = "+" if r.delta >= 0 else ""
        console.print(
            f"  {icon} {r.provider:<28} {pct(r.golden_rate)} → {color(pct(r.current_rate))}  ({sign}{pct(r.delta)})"
        )

    regressed = [r for r in results if r.regressed]
    if regressed:
        console.print(f"\n  [red][bold]FAIL: {len(regressed)} provider(s) regressed[/bold][/red]\n")
        return True

    console.print("\n  [green][bold]PASS: no regressions[/bold][/green]\n")
    return False


def _load_benchmark(file_path: str) -> BenchmarkFile:
    raw = json.loads(Path(file_path).read_text())
    return BenchmarkFile.model_validate(raw)


def run_compare(golden_path: str, current_path: str) -> None:
    golden = _load_benchmark(golden_path)
    current = _load_benchmark(current_path)
    results = compare_benchmarks(golden.provider_summary, current.provider_summary)
    failed = print_comparison(results, golden_path)
    if failed:
        raise SystemExit(1)
