from __future__ import annotations

import asyncio
import tempfile
from collections.abc import Callable
from dataclasses import dataclass

from skill_eval.config.schema import ResolvedConfig
from skill_eval.grader.grader import grade_run
from skill_eval.providers.factory import create_provider
from skill_eval.providers.pricing import estimate_cost
from skill_eval.providers.types import LLMProvider
from skill_eval.schemas.benchmark import BenchmarkRun, RunResult
from skill_eval.schemas.evals import EvalCase, get_turns
from skill_eval.schemas.grading import ExpectationResult, GradingResult
from skill_eval.utils.async_utils import with_timeout
from skill_eval.utils.error import extract_error_message
from skill_eval.utils.math_utils import mean, stddev
from skill_eval.utils.rate import rate_color

from .agent_loop import run_agent_loop
from .sandbox import collect_output_files, seed_sandbox
from .tools import DEFAULT_TOOLS, create_tool_handlers
from .turn_check import create_turn_checker

try:
    from rich import print as rprint
except ImportError:
    rprint = print

MAX_RETRIES = 2
RETRY_BASE_MS = 2000
MAX_CONCURRENCY = 10

RETRYABLE_STATUS_CODES = {429, 502, 503, 529}
RETRYABLE_MESSAGES = ["rate limit", "overloaded", "unavailable", "high demand"]


@dataclass
class RunEntry:
    eval_case: EvalCase
    provider: LLMProvider
    run_number: int


def _is_retryable(err: BaseException) -> bool:
    e = getattr(err, "__dict__", {}) or {}
    status = e.get("status") or e.get("code")
    if isinstance(status, int) and status in RETRYABLE_STATUS_CODES:
        return True
    msg = str(getattr(err, "message", str(err))).lower()
    return any(m in msg for m in RETRYABLE_MESSAGES)


def _task_id(entry: RunEntry) -> str:
    return f"{entry.eval_case.id}-{entry.provider.model_id}-{entry.run_number}"


def _task_label(entry: RunEntry) -> str:
    return f"eval {entry.eval_case.id} · {entry.provider.model_id} · r{entry.run_number}"


def _build_failure_result(entry: RunEntry, err_msg: str) -> BenchmarkRun:
    return BenchmarkRun(
        eval_id=entry.eval_case.id,
        provider=entry.provider.name,
        model=entry.provider.model_id,
        run_number=entry.run_number,
        result=RunResult(
            pass_rate=0,
            passed=0,
            failed=len(entry.eval_case.assertions),
            total=len(entry.eval_case.assertions),
            time_seconds=0,
            input_tokens=0,
            output_tokens=0,
            total_tokens=0,
            tool_calls=0,
            errors=1,
            cost_usd=0,
        ),
        expectations=[
            ExpectationResult(text=a, passed=False, evidence=f"Error: {err_msg}")
            for a in entry.eval_case.assertions
        ],
        claims=[],
        eval_feedback=None,
        error=err_msg,
    )


def _compute_provider_summary(
    runs: list[BenchmarkRun],
) -> dict[str, dict[str, dict[str, float]]]:
    grouped: dict[str, list[BenchmarkRun]] = {}
    for run in runs:
        key = run.model
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(run)

    summary: dict[str, dict[str, dict[str, float]]] = {}
    for key, model_runs in grouped.items():
        def _stat(fn, runs=model_runs):
            vals = [fn(r) for r in runs]
            return {"mean": mean(vals), "stddev": stddev(vals)}

        summary[key] = {
            "pass_rate": _stat(lambda r: r.result.pass_rate),
            "time_seconds": _stat(lambda r: r.result.time_seconds),
            "total_tokens": _stat(lambda r: r.result.total_tokens),
            "cost_usd": _stat(lambda r: r.result.cost_usd),
        }
    return summary


def _format_success_line(
    completed: int, total: int, entry: RunEntry, result: BenchmarkRun
) -> str:
    r = result.result
    color_fn = rate_color(r.pass_rate)
    return (
        f"  [green]✓[/green] [{completed}/{total}] "
        f"eval {entry.eval_case.id} · {entry.provider.model_id} · "
        f"run {entry.run_number} · "
        f"{color_fn(f'{r.pass_rate * 100:.0f}%')} [dim]({r.passed}/{r.total})[/dim] · "
        f"[dim]{r.time_seconds:.1f}s · {r.total_tokens} tok · "
        f"${r.cost_usd:.4f} · {r.tool_calls} calls[/dim]"
    )


async def run_orchestrator(
    config: ResolvedConfig,
    evals: list[EvalCase],
    skill_dir: str,
    system_prompt: str,
    *,
    concurrency: int | None = None,
    on_progress: Callable[[str], None] | None = None,
) -> dict:
    log = on_progress or (lambda msg: rprint(msg))

    grader_provider = create_provider(config.grader)

    matrix: list[RunEntry] = []
    for eval_case in evals:
        for provider_config in config.providers:
            provider = create_provider(provider_config)
            for run in range(1, config.settings.runs_per_provider + 1):
                matrix.append(
                    RunEntry(eval_case=eval_case, provider=provider, run_number=run)
                )

    concurrency_limit = concurrency or min(len(matrix), MAX_CONCURRENCY)

    log(f"[bold]Running {len(matrix)} eval(s): {len(evals)} eval(s) × "
        f"{len(config.providers)} provider(s) × {config.settings.runs_per_provider} run(s)[/bold]")

    results: list[BenchmarkRun] = []
    from .spinner import Spinner

    spinner = Spinner()
    completed = 0
    queue: asyncio.Queue[RunEntry | None] = asyncio.Queue()
    for entry in matrix:
        await queue.put(entry)
    for _ in range(concurrency_limit):
        await queue.put(None)

    async def execute_one(entry: RunEntry) -> BenchmarkRun:
        eval_timeout_sec = config.settings.timeout
        sandbox_dir = tempfile.mkdtemp(prefix="skill-eval-")
        try:
            seed_sandbox(sandbox_dir, skill_dir, entry.eval_case.files)
            turns = get_turns(entry.eval_case)

            agent_run = await with_timeout(
                run_agent_loop(
                    provider=entry.provider,
                    system=system_prompt,
                    turns=turns,
                    tools=DEFAULT_TOOLS,
                    tool_handlers=create_tool_handlers(
                        sandbox_dir, int(config.settings.timeout)
                    ),
                    max_steps=config.settings.max_steps,
                    temperature=config.settings.temperature,
                    on_activity=lambda d: spinner.detail(_task_id(entry), d),
                    check_turn_relevance=(
                        create_turn_checker(grader_provider)
                        if len(turns) > 1
                        else None
                    ),
                ),
                eval_timeout_sec,
                f"Eval timed out after {config.settings.timeout}s",
            )

            output_files = collect_output_files(sandbox_dir)
            spinner.detail(_task_id(entry), "grading…")
            grading: GradingResult = await grade_run(
                grader_provider, entry.eval_case, agent_run, output_files
            )

            cost = estimate_cost(
                entry.provider.model_id,
                agent_run.total_input_tokens,
                agent_run.total_output_tokens,
            )

            return BenchmarkRun(
                eval_id=entry.eval_case.id,
                provider=entry.provider.name,
                model=entry.provider.model_id,
                run_number=entry.run_number,
                result=RunResult(
                    pass_rate=grading.pass_rate,
                    passed=grading.passed,
                    failed=grading.failed,
                    total=grading.total,
                    time_seconds=agent_run.total_latency_ms / 1000,
                    input_tokens=agent_run.total_input_tokens,
                    output_tokens=agent_run.total_output_tokens,
                    total_tokens=agent_run.total_input_tokens
                    + agent_run.total_output_tokens,
                    tool_calls=agent_run.total_tool_calls,
                    errors=agent_run.errors,
                    cost_usd=cost,
                ),
                expectations=grading.expectations,
                claims=grading.claims,
                eval_feedback=grading.eval_feedback,
                error=None,
            )
        finally:
            import shutil

            shutil.rmtree(sandbox_dir, ignore_errors=True)

    async def run_task(entry: RunEntry) -> None:
        nonlocal completed
        tid = _task_id(entry)
        spinner.track(tid, _task_label(entry))

        attempt = 0
        while True:
            try:
                result = await execute_one(entry)
                results.append(result)
                completed += 1
                spinner.succeed(
                    tid,
                    _format_success_line(completed, len(matrix), entry, result),
                )
                return
            except Exception as err:
                attempt += 1
                err_msg = extract_error_message(err)

                if _is_retryable(err) and attempt <= MAX_RETRIES:
                    delay_ms = RETRY_BASE_MS * (2 ** (attempt - 1))
                    spinner.detail(
                        tid,
                        f"retrying in {delay_ms / 1000:.0f}s "
                        f"({attempt + 1}/{MAX_RETRIES + 1})",
                    )
                    await asyncio.sleep(delay_ms / 1000)
                    spinner.untrack(tid)
                    spinner.track(tid, _task_label(entry))
                    continue

                results.append(_build_failure_result(entry, err_msg))
                completed += 1
                spinner.succeed(
                    tid,
                    f"  [red]✗[/red] [{completed}/{len(matrix)}] "
                    f"eval {entry.eval_case.id} · {entry.provider.model_id} · "
                    f"run {entry.run_number} · [red]{err_msg}[/red]",
                )
                return

    async def worker() -> None:
        while True:
            entry = await queue.get()
            if entry is None:
                break
            await run_task(entry)

    spinner.start(len(matrix))
    await asyncio.gather(*[worker() for _ in range(concurrency_limit)])
    spinner.stop()

    return {
        "runs": results,
        "providerSummary": _compute_provider_summary(results),
    }
