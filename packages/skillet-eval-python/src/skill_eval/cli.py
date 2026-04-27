from __future__ import annotations

import asyncio
from pathlib import Path

import typer

from skill_eval import __version__
from skill_eval.config import load_dotenv

app = typer.Typer(
    name="skillet-eval",
    help="Python reference implementation for skillet eval",
    no_args_is_help=True,
)


def _load_env_for_skill(skill: str | None = None) -> None:
    dirs = [str(Path.cwd())]
    if skill:
        dirs.append(str(Path(skill).resolve()))
    load_dotenv(dirs)


@app.command()
def init() -> None:
    """Scaffold a skillet.eval.yaml config file interactively."""
    _load_env_for_skill()
    from skill_eval.commands.init_cmd import run_init

    run_init()


@app.command()
def generate(
    skill: str = typer.Argument(".", help="Skill directory path"),
    count: int = typer.Option(3, "--count", "-c", help="Number of evals to generate"),
    config: str | None = typer.Option(None, "--config", help="Path to skillet.eval.yaml"),
) -> None:
    """Auto-generate a starter evals.json from SKILL.md using an LLM."""
    _load_env_for_skill(skill)

    async def _run() -> None:
        from skill_eval.commands.generate import run_generate

        await run_generate(skill, count, config)

    asyncio.run(_run())


@app.command()
def validate(
    skill: str = typer.Argument(".", help="Skill directory path"),
    evals: str | None = typer.Option(None, "--evals", help="Path to evals.json"),
    config: str | None = typer.Option(None, "--config", help="Path to skillet.eval.yaml"),
) -> None:
    """Pre-flight checks: verify skill directory, evals, and API keys."""
    _load_env_for_skill(skill)
    from skill_eval.commands.validate import run_validate

    run_validate(skill, evals, config)


@app.command()
def serve(
    skill: str = typer.Argument(".", help="Skill directory path"),
    evals: str | None = typer.Option(None, "--evals", help="Path to evals.json"),
    port: int = typer.Option(3000, "--port", "-p", help="Port to serve on"),
) -> None:
    """Serve a local dashboard showing eval results history."""
    _load_env_for_skill(skill)
    from skill_eval.commands.serve import run_serve

    run_serve(skill, evals, port)


@app.command()
def run(
    skill: str = typer.Argument(".", help="Skill directory path"),
    evals: str | None = typer.Option(None, "--evals", help="Path to evals.json"),
    config: str | None = typer.Option(None, "--config", help="Path to skillet.eval.yaml"),
    eval_id: str | None = typer.Option(None, "--eval-id", help="Comma-separated eval IDs"),
    providers: str | None = typer.Option(None, "--providers", help="Comma-separated provider names"),
    model: list[str] = typer.Option([], "--model", "-m", help="Model name (repeatable)"),
    output: str = typer.Option("json", "--output", help="Output format"),
    runs: int | None = typer.Option(None, "--runs", help="Runs per provider per eval"),
    timeout: float | None = typer.Option(None, "--timeout", help="Timeout per eval in seconds"),
    concurrency: int | None = typer.Option(None, "--concurrency", help="Max concurrent eval runs"),
    golden: str | None = typer.Option(None, "--golden", help="Golden benchmark file to compare against for regression"),
) -> None:
    """Run evals across configured providers."""
    _load_env_for_skill(skill)

    async def _run() -> None:
        from skill_eval.commands.run import RunOpts, run_run

        opts = RunOpts(
            skill=skill,
            evals=evals,
            config=config,
            eval_id=eval_id,
            providers=providers,
            model=model if model else None,
            output=output,
            runs=runs,
            timeout=timeout,
            concurrency=concurrency,
            golden=golden,
        )
        try:
            await run_run(opts)
        except SystemExit:
            raise
        except Exception as err:
            from rich.console import Console

            from skill_eval.utils.error import extract_error_message

            Console().print(f"[red]Error: {extract_error_message(err)}[/red]")
            raise typer.Exit(1) from None

    asyncio.run(_run())


@app.command()
def compare(
    golden: str = typer.Argument(..., help="Path to golden benchmark JSON"),
    current: str = typer.Argument(..., help="Path to current benchmark JSON"),
) -> None:
    """Compare two benchmark JSON files and report pass rate regressions."""
    from skill_eval.commands.compare import run_compare

    run_compare(golden, current)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"skillet-eval v{__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: bool = typer.Option(
        False,
        "--version",
        "-v",
        help="Show version",
        callback=_version_callback,
        is_eager=True,
    ),
) -> None:
    pass


if __name__ == "__main__":
    app()
