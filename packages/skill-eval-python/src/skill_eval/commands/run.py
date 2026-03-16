from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from rich.console import Console

from skill_eval import __version__
from skill_eval.config import load_config, resolve_skill_paths
from skill_eval.config.schema import CliOverrides
from skill_eval.report.console_reporter import print_results
from skill_eval.report.html_reporter import write_dashboard
from skill_eval.report.json_reporter import write_benchmark_json
from skill_eval.runner.orchestrator import run_orchestrator
from skill_eval.schemas.evals import EvalCase, EvalsFile


@dataclass
class RunOpts:
    skill: str
    evals: str | None = None
    config: str | None = None
    eval_id: str | None = None
    providers: str | None = None
    model: list[str] | None = None
    output: str = "json"
    runs: int | None = None
    timeout: float | None = None
    concurrency: int | None = None


def build_system_prompt(skill_content: str) -> str:
    return f"""You are an AI assistant with access to tools. Follow the skill instructions below to complete the user's task.

<skill_instructions>
{skill_content}
</skill_instructions>

Use the available tools (bash, read_file, write_file, list_directory) to complete the task. Work step by step."""


async def run_run(opts: RunOpts) -> None:
    paths = resolve_skill_paths(opts.skill, opts.evals)

    if not Path(paths["skill_file"]).exists():
        console = Console()
        console.print(f"[red]SKILL.md not found at {paths['skill_file']}[/red]")
        raise SystemExit(1)

    if not Path(paths["evals_file"]).exists():
        console = Console()
        console.print(f"[red]evals.json not found at {paths['evals_file']}[/red]")
        console.print(
            f"\nRun [bold]skill-eval generate {opts.skill}[/bold] to auto-generate evals from SKILL.md,\n"
            "or create evals.json manually.\n"
        )
        raise SystemExit(1)

    skill_content = Path(paths["skill_file"]).read_text()
    system_prompt = build_system_prompt(skill_content)

    raw_evals = Path(paths["evals_file"]).read_text()
    evals_file = EvalsFile.model_validate(json.loads(raw_evals))

    models = opts.model or evals_file.models
    overrides = CliOverrides(
        config_path=opts.config,
        providers=opts.providers.split(",") if opts.providers else None,
        models=models,
        runs=opts.runs,
        timeout=opts.timeout,
    )
    config = load_config(overrides)

    evals: list[EvalCase] = evals_file.evals
    if opts.eval_id:
        ids = [int(x.strip()) for x in opts.eval_id.split(",")]
        evals = [e for e in evals if e.id in ids]
        if not evals:
            console = Console()
            console.print(f"[red]No evals found with IDs: {opts.eval_id}[/red]")
            raise SystemExit(1)

    _print_run_header(opts, paths, evals, config)

    result = await run_orchestrator(
        config,
        evals,
        paths["skill_dir"],
        system_prompt,
        concurrency=opts.concurrency,
    )

    provider_summary = result.get("provider_summary") or result.get("providerSummary") or {}
    print_results(
        {"runs": result["runs"], "provider_summary": provider_summary},
        evals,
        len(config.providers),
    )
    _write_outputs(result, config, evals_file, evals, opts, paths)


def _print_run_header(
    opts: RunOpts,
    paths: dict[str, str],
    evals: list[EvalCase],
    config,
) -> None:
    from skill_eval.config import PROVIDER_REGISTRY

    console = Console()
    console.print(f"\n  [bold]skill-eval v{__version__}[/bold]\n")
    console.print(f"  Skill:     {paths['skill_dir']}")
    console.print(f"  Evals:     {len(evals)} eval(s)")
    console.print(f"  Providers: {', '.join(p.model for p in config.providers)}")
    if len(config.providers) == 1:
        import os

        all_env_keys = []
        for entry in PROVIDER_REGISTRY.values():
            all_env_keys.extend(entry.env_keys)
        missing = [k for k in all_env_keys if not os.environ.get(k)]
        if missing:
            console.print(f"              [dim]Set {', '.join(missing)} to compare more providers[/dim]")
    console.print(f"  Runs:      {config.settings.runs_per_provider} per provider")
    console.print(f"  Grader:    {config.grader.model}")
    console.print()


def _write_outputs(
    result: dict,
    config,
    evals_file: EvalsFile,
    evals: list[EvalCase],
    opts: RunOpts,
    paths: dict[str, str],
) -> None:
    from datetime import datetime

    from rich.console import Console

    stamp = datetime.now().isoformat().replace(":", "-").replace(".", "-")[:19]
    results_dir = paths["results_dir"]
    Path(results_dir).mkdir(parents=True, exist_ok=True)

    meta = {
        "skill_name": evals_file.skill_name,
        "skill_path": opts.skill,
        "evals_run": [e.id for e in evals],
    }

    console = Console()
    console.print("[bold]  Output[/bold]\n")

    json_path = str(Path(results_dir) / f"{stamp}.json")
    write_benchmark_json(result, config, meta, json_path)
    console.print(f"  [green]✓[/green] {json_path}")

    dashboard_path = write_dashboard(results_dir)
    console.print(f"  [green]✓[/green] {dashboard_path} [dim](dashboard)[/dim]")

    console.print(
        f"\n  [dim]Run [bold]skill-eval serve {opts.skill}[/bold] to view results in the browser[/dim]\n"
    )
    console.print(f"  [dim]Results stored in [bold]{results_dir}[/bold][/dim]\n")
