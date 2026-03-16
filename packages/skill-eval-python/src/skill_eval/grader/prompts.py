from __future__ import annotations

import json

from skill_eval.runner.transcript import AgentRun, TranscriptStep
from skill_eval.schemas.evals import EvalCase, get_turns

MAX_GRADING_CHARS = 300_000
CAP_USER_MESSAGE = 1_000
CAP_ASSISTANT_RESPONSE = 3_000
CAP_OUTPUT_FILE = 5_000
CAP_TOOL_VALUE = 2_000
CAP_SKIPPED_TURN = 200


def _cap(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n\n... [truncated {len(text) - limit} chars] ..."


def _trunc_val(val: object, max_len: int = CAP_TOOL_VALUE) -> str:
    s = val if isinstance(val, str) else json.dumps(val, default=str)
    return f"{s[:max_len]}… [{len(s) - max_len} chars truncated]" if len(s) > max_len else s


def _format_transcript_step(
    step: TranscriptStep, last_turn: int
) -> tuple[str, int]:
    parts: list[str] = []
    current_last_turn = last_turn

    if step.turn is not None and step.turn != current_last_turn:
        current_last_turn = step.turn
        if step.turn > 0:
            parts.append(f"\n=== User Turn {step.turn + 1} ===")
            if step.user_message:
                parts.append(f"User: {_cap(step.user_message, CAP_USER_MESSAGE)}")
            parts.append("")

    parts.append(f"--- Step {step.step} ---")
    if step.response:
        parts.append(f"Assistant: {_cap(step.response, CAP_ASSISTANT_RESPONSE)}")
    for tc in step.tool_calls or []:
        parts.append(f"Tool call: {tc.name}({_trunc_val(tc.arguments)})")
    for tr in step.tool_results:
        parts.append(f"Tool result [{tr.name}]: {_trunc_val(tr.result)}")
    if step.turn_skipped:
        parts.append(
            f"\n⚠ TURN SKIPPED: The next scripted user message (\"{_cap(step.turn_skipped, CAP_SKIPPED_TURN)}\") "
            "was not injected because it did not match the agent's response. The conversation ended here."
        )

    return "\n".join(parts), current_last_turn


def _format_transcript(agent_run: AgentRun) -> str:
    last_turn = -1
    result: list[str] = []
    for step in agent_run.transcript:
        text, last_turn = _format_transcript_step(step, last_turn)
        result.append(text)
    return "\n\n".join(result)


def _format_output_files(
    output_files: list[dict[str, str]],
) -> str:
    if not output_files:
        return "(no output files)"
    return "\n\n".join(
        f"--- {f['path']} ---\n{_cap(f['content'], CAP_OUTPUT_FILE)}"
        for f in output_files
    )


def _format_turns_section(turns: list[str], is_multi_turn: bool) -> str:
    if is_multi_turn:
        lines = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(turns))
        return (
            f"**Conversation turns:**\n{lines}\n\n"
            "This is a multi-turn conversation. The user sends the first message, "
            "the agent responds (possibly with tool calls), then the next user message "
            "is injected, and so on. Evaluate assertions across the full conversation."
        )
    return f"**Prompt given to the agent:**\n{turns[0]}"


def build_grading_prompt(
    eval_case: EvalCase,
    agent_run: AgentRun,
    output_files: list[dict[str, str]],
) -> str:
    turns = get_turns(eval_case)
    is_multi_turn = len(turns) > 1
    turns_section = _format_turns_section(turns, is_multi_turn)
    transcript_text = _format_transcript(agent_run)
    files_text = _format_output_files(output_files)
    assertions_list = "\n".join(f"{i + 1}. {a}" for i, a in enumerate(eval_case.assertions))

    prompt = f"""You are an evaluator grading the output of an AI agent that was given a task.

## Original Task

{turns_section}

**Expected behavior:**
{eval_case.expected_output}

## Assertions to Evaluate

Evaluate each of the following assertions. For each one, determine whether the agent's behavior satisfies it, and provide specific evidence from the transcript.

{assertions_list}

## Agent Transcript

{transcript_text}

## Output Files Produced

{files_text}

## Instructions

Return a JSON object with this exact structure (no other text, just JSON):

{{
  "expectations": [
    {{
      "text": "<the assertion text>",
      "passed": true/false,
      "evidence": "<specific evidence from the transcript>"
    }}
  ],
  "claims": [],
  "eval_feedback": "<optional overall feedback or null>"
}}

There must be exactly one entry in "expectations" for each assertion listed above, in the same order. Be strict: only mark an assertion as passed if the transcript clearly demonstrates it."""

    return _cap(prompt, MAX_GRADING_CHARS)


GRADER_SYSTEM_PROMPT = (
    "You are a precise evaluator. You grade AI agent outputs against specific assertions. "
    "Return only valid JSON matching the requested schema. Be strict but fair."
)
