from __future__ import annotations

from rich.console import Console

from skill_eval.schemas.evals import EvalCase, get_turns
from skill_eval.utils.rate import rate_color

LABEL_TRUNCATE = 100
EVIDENCE_TRUNCATE = 200


def print_results(
    result: dict,
    evals: list[EvalCase],
    provider_count: int,
) -> None:
    console = Console()
    console.print("\n  [bold]Results[/bold]\n")

    by_eval: dict[int, list] = {}
    for run in result["runs"]:
        eval_id = run.get("eval_id") or run.eval_id
        if eval_id not in by_eval:
            by_eval[eval_id] = []
        by_eval[eval_id].append(run)

    total_passed = 0
    total_failed = 0

    for eval_id, runs in sorted(by_eval.items()):
        eval_case = next((e for e in evals if e.id == eval_id), None)
        turns = get_turns(eval_case) if eval_case else []
        label = (turns[0] or "")[:LABEL_TRUNCATE]
        suffix = "..." if len(label) >= LABEL_TRUNCATE else ""
        console.print(f"  [bold]Eval {eval_id}[/bold] [dim]—[/dim] {label}{suffix}")

        for run in runs:
            r = run.get("result") or run.result
            total_passed += r.get("passed", r.passed)
            total_failed += r.get("failed", r.failed)

            provider_label = ""
            if provider_count > 1:
                model = run.get("model") or run.model
                provider_label = f"[dim][[/dim]{model}[dim]][/dim] "

            for exp in run.get("expectations") or run.expectations:
                text = exp.get("text") or exp.text
                passed = exp.get("passed", exp.passed)
                if passed:
                    console.print(f"    [green]✓[/green] {provider_label}{text}")
                else:
                    console.print(f"    [red]✗[/red] {provider_label}{text}")
                    evidence = exp.get("evidence", getattr(exp, "evidence", "")) or ""
                    if evidence:
                        console.print(
                            f"      [dim]{evidence[:EVIDENCE_TRUNCATE]}[/dim]"
                        )

            eval_feedback = run.get("eval_feedback") or getattr(
                run, "eval_feedback", None
            )
            if eval_feedback:
                console.print(f"    [dim]› {eval_feedback}[/dim]")

            if provider_count > 1:
                passed_val = r.get("passed", r.passed)
                total_val = r.get("total", r.total)
                time_val = r.get("time_seconds", r.time_seconds)
                console.print(
                    f"    [dim]{passed_val}/{total_val} passed · "
                    f"{time_val:.1f}s[/dim]"
                )
        console.print()

    total_assertions = total_passed + total_failed
    overall_rate = total_passed / total_assertions if total_assertions > 0 else 0
    score_color = rate_color(overall_rate)

    console.print("[bold]  Scorecard[/bold]\n")
    console.print(
        f"  {score_color(f'{(overall_rate * 100):.0f}%')} overall  "
        f"[dim]({total_passed} passed, {total_failed} failed out of "
        f"{total_assertions} assertions)[/dim]"
    )

    summary = result.get("provider_summary") or result.get("providerSummary") or {}
    for key, stats in summary.items():
        mean_rate = stats.get("pass_rate", {}).get("mean", 0)
        color = rate_color(mean_rate)
        time_mean = stats.get("time_seconds", {}).get("mean", 0)
        tok_mean = stats.get("total_tokens", {}).get("mean", 0)
        cost_mean = stats.get("cost_usd", {}).get("mean", 0)
        console.print(
            f"  {color(f'{(mean_rate * 100):.0f}%')} {key}  "
            f"[dim]{time_mean:.1f}s avg · {tok_mean:.0f} tok · "
            f"${cost_mean:.4f}[/dim]"
        )
    console.print()
