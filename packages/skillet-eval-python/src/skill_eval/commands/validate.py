from __future__ import annotations

import json
from pathlib import Path

from rich.console import Console

from skill_eval.config import load_config, resolve_skill_paths
from skill_eval.config.schema import CliOverrides
from skill_eval.schemas.evals import EvalsFile
from skill_eval.utils.error import extract_error_message


async def run_validate(
    skill: str,
    evals_path: str | None = None,
    config_path: str | None = None,
) -> None:
    console = Console()
    has_error = False

    def pass_msg(msg: str) -> None:
        console.print(f"  [green]✓[/green] {msg}")

    def fail_msg(msg: str) -> None:
        nonlocal has_error
        console.print(f"  [red]✗[/red] {msg}")
        has_error = True

    console.print("\n[bold]Skill Eval — Validate[/bold]\n")

    paths = resolve_skill_paths(skill, evals_path)

    if Path(paths["skill_dir"]).exists() and Path(paths["skill_dir"]).is_dir():
        pass_msg(f"Skill directory: {paths['skill_dir']}")
    else:
        fail_msg(f"Skill directory not found: {paths['skill_dir']}")

    skill_file = Path(paths["skill_file"])
    if skill_file.exists():
        size_kb = skill_file.stat().st_size / 1024
        pass_msg(f"SKILL.md found ({size_kb:.1f} KB)")
    else:
        fail_msg(f"SKILL.md not found at {paths['skill_file']}")

    evals_file = Path(paths["evals_file"])
    if evals_file.exists():
        try:
            raw = json.loads(evals_file.read_text())
            parsed = EvalsFile.model_validate(raw)
            total = sum(len(e.assertions) for e in parsed.evals)
            pass_msg(f"evals.json valid ({len(parsed.evals)} evals, {total} assertions)")
        except Exception as err:
            fail_msg(f"evals.json invalid: {extract_error_message(err)}")
    else:
        fail_msg(f"evals.json not found at {paths['evals_file']}")

    try:
        config = load_config(CliOverrides(config_path=config_path))
        for p in config.providers:
            pass_msg(f"{p.model}: API key valid")
    except Exception as err:
        fail_msg(f"Config: {extract_error_message(err)}")

    console.print()

    if has_error:
        console.print("[red]Validation found issues. Fix them before running evals.[/red]\n")
        raise SystemExit(1)
    else:
        console.print("[green]All checks passed. Ready to run evals.[/green]\n")
