from __future__ import annotations

import json
import os
from collections.abc import Awaitable, Callable

from skill_eval.providers.types import (
    ChatParams,
    ChatResponse,
    LLMProvider,
    Message,
    ToolDefinition,
    ToolHandler,
)
from skill_eval.utils.async_utils import with_timeout
from skill_eval.utils.error import extract_error_message
from skill_eval.utils.string import truncate

from .context import (
    compact_messages,
    debug_payload_log,
    extract_snippet,
    summarize_tool_args,
    total_payload_size,
)
from .transcript import ToolResult, TranscriptStep, build_agent_run

CHARS_PER_TOKEN = 4
API_CALL_TIMEOUT_SEC = 120


def _usage_dict(response: ChatResponse) -> dict[str, int]:
    u = response.usage
    if hasattr(u, "input_tokens"):
        return {"inputTokens": u.input_tokens, "outputTokens": u.output_tokens}
    return {
        "inputTokens": u.get("inputTokens", u.get("input_tokens", 0)),
        "outputTokens": u.get("outputTokens", u.get("output_tokens", 0)),
    }


async def run_agent_loop(
    *,
    provider: LLMProvider,
    system: str,
    user_prompt: str | None = None,
    turns: list[str] | None = None,
    tools: list[ToolDefinition],
    tool_handlers: dict[str, ToolHandler],
    max_steps: int = 20,
    temperature: float | None = None,
    on_activity: Callable[[str], None] | None = None,
    check_turn_relevance: Callable[[str, str], Awaitable[bool]] | None = None,
):
    resolved_turns = turns if turns is not None else ([user_prompt] if user_prompt else [])
    if not resolved_turns:
        raise ValueError("No user turns provided")

    next_turn = 1
    current_turn = 0
    emit = on_activity or (lambda _: None)
    transcript: list[TranscriptStep] = []
    messages: list[Message] = [Message(role="user", content=resolved_turns[0])]
    debug = bool(os.environ.get("SKILL_EVAL_DEBUG"))

    for step in range(max_steps):
        if debug:
            pre_size, breakdown = debug_payload_log(step, messages, system)
            print(
                f"\n[debug] step {step + 1} | {len(messages)} msgs | "
                f"~{pre_size / 1024:.0f}KB (~{round(pre_size / CHARS_PER_TOKEN):,} tok)",
                flush=True,
            )
            for line in breakdown:
                print(line, flush=True)

        emit(f"step {step + 1} — calling model…")

        pre_size = total_payload_size(system, messages) if debug else 0
        compact_messages(messages, system)

        if debug:
            post_size = total_payload_size(system, messages)
            if post_size < pre_size:
                print(
                    f"[debug] compacted {pre_size / 1024:.0f}KB → {post_size / 1024:.0f}KB",
                    flush=True,
                )

        response = await with_timeout(
            provider.chat(ChatParams(system=system, messages=messages, tools=tools, temperature=temperature)),
            API_CALL_TIMEOUT_SEC,
            f"provider.chat (step {step + 1})",
        )

        transcript_step = TranscriptStep(
            step=step,
            turn=current_turn,
            response=response.content,
            tool_calls=response.tool_calls,
            tool_results=[],
            usage=_usage_dict(response),
            latency_ms=response.latency_ms,
        )

        text_snippet = extract_snippet(response.content)
        if text_snippet:
            emit(text_snippet)

        if response.stop_reason != "tool_use" or not response.tool_calls:
            transcript.append(transcript_step)

            if next_turn < len(resolved_turns):
                user_reply = resolved_turns[next_turn]

                if check_turn_relevance:
                    emit("checking turn relevance…")
                    relevant = await check_turn_relevance(response.content, user_reply)
                    if not relevant:
                        emit(
                            "turn mismatch — agent didn't ask for expected input, ending conversation"
                        )
                        transcript_step.turn_skipped = user_reply
                        return build_agent_run(transcript)

                messages.append(
                    Message(role="assistant", content=response.content)
                )
                current_turn = next_turn
                next_turn += 1
                emit(f"turn {current_turn + 1} — user: {truncate(user_reply, 60)}")
                transcript_step.user_message = user_reply
                messages.append(Message(role="user", content=user_reply))
                continue

            emit(f"done — {text_snippet}" if text_snippet else "done")
            return build_agent_run(transcript)

        messages.append(
            Message(
                role="assistant",
                content=response.content,
                tool_calls=response.tool_calls,
            )
        )

        for tc in response.tool_calls or []:
            arg_snippet = summarize_tool_args(tc.name, tc.arguments)
            emit(f"{tc.name}({arg_snippet})")

            handler = tool_handlers.get(tc.name)
            result: object
            if handler:
                try:
                    result = await handler(tc.arguments)
                except Exception as err:
                    result = {"error": extract_error_message(err)}
            else:
                result = {"error": f"Unknown tool: {tc.name}"}

            transcript_step.tool_results.append(
                ToolResult(id=tc.id, name=tc.name, result=result)
            )
            messages.append(
                Message(
                    role="tool_result",
                    content=json.dumps(result, default=str),
                    tool_call_id=tc.id,
                )
            )

        transcript.append(transcript_step)

    return build_agent_run(transcript)
