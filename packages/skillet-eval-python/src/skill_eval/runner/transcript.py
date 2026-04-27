from __future__ import annotations

from dataclasses import dataclass

from skill_eval.providers.types import ToolCall


@dataclass
class ToolResult:
    id: str
    name: str
    result: object


@dataclass
class TranscriptStep:
    step: int
    turn: int | None = None
    user_message: str | None = None
    turn_skipped: str | None = None
    response: str = ""
    tool_calls: list[ToolCall] | None = None
    tool_results: list[ToolResult] = None
    usage: dict[str, int] = None
    latency_ms: float = 0

    def __post_init__(self) -> None:
        if self.tool_results is None:
            self.tool_results = []
        if self.usage is None:
            self.usage = {"inputTokens": 0, "outputTokens": 0}


@dataclass
class AgentRun:
    transcript: list[TranscriptStep]
    final_output: str
    total_input_tokens: int
    total_output_tokens: int
    total_latency_ms: float
    total_tool_calls: int
    errors: int
    steps: int


def build_agent_run(transcript: list[TranscriptStep]) -> AgentRun:
    total_input_tokens = 0
    total_output_tokens = 0
    total_latency_ms = 0.0
    total_tool_calls = 0
    errors = 0

    for step in transcript:
        total_input_tokens += step.usage.get("inputTokens", 0)
        total_output_tokens += step.usage.get("outputTokens", 0)
        total_latency_ms += step.latency_ms
        total_tool_calls += len(step.tool_calls) if step.tool_calls else 0
        for tr in step.tool_results:
            r = tr.result
            if isinstance(r, dict) and r.get("error"):
                errors += 1

    last_step = transcript[-1] if transcript else None
    return AgentRun(
        transcript=transcript,
        final_output=last_step.response if last_step else "",
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        total_latency_ms=total_latency_ms,
        total_tool_calls=total_tool_calls,
        errors=errors,
        steps=len(transcript),
    )
