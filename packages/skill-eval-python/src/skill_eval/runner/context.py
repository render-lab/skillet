from __future__ import annotations

import json

from skill_eval.providers.types import Message
from skill_eval.utils.string import truncate

CHARS_PER_TOKEN = 4
MAX_CONTEXT_TOKENS = 80_000
MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN
COMPACT_MIN_LENGTH = 200
PROTECTED_TAIL_MESSAGES = 6
SNIPPET_MAX_LENGTH = 80
TOOL_ARG_DISPLAY_MAX = 60


def message_size(m: Message) -> int:
    size = len(m.content) if m.content else 0
    if m.tool_calls:
        for tc in m.tool_calls:
            size += len(json.dumps(tc.arguments))
    return size


def total_payload_size(system: str, messages: list[Message]) -> int:
    return len(system) + sum(message_size(m) for m in messages)


def compact_messages(messages: list[Message], system: str) -> None:
    if total_payload_size(system, messages) <= MAX_CONTEXT_CHARS:
        return

    placeholder = "[truncated]"

    for i in range(1, len(messages) - PROTECTED_TAIL_MESSAGES):
        if total_payload_size(system, messages) <= MAX_CONTEXT_CHARS:
            break
        msg = messages[i]
        if msg.content and len(msg.content) > COMPACT_MIN_LENGTH:
            msg.content = placeholder
        if msg.tool_calls:
            for tc in msg.tool_calls:
                for key, val in list(tc.arguments.items()):
                    if isinstance(val, str) and len(val) > COMPACT_MIN_LENGTH:
                        tc.arguments[key] = placeholder


def extract_snippet(content: str) -> str | None:
    if not content or not isinstance(content, str):
        return None
    for line in content.split("\n"):
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or trimmed.startswith("```") or trimmed.startswith("<"):
            continue
        return truncate(trimmed, SNIPPET_MAX_LENGTH)
    return None


def summarize_tool_args(name: str, args: dict[str, object]) -> str:
    if name == "bash" and isinstance(args.get("command"), str):
        return truncate(args["command"], TOOL_ARG_DISPLAY_MAX)
    if name in ("read_file", "write_file", "list_directory") and isinstance(args.get("path"), str):
        return args["path"]
    return truncate(json.dumps(args), TOOL_ARG_DISPLAY_MAX)


def debug_payload_log(
    step: int,
    messages: list[Message],
    system: str,
) -> tuple[int, list[str]]:
    pre_size = total_payload_size(system, messages)
    breakdown = []
    for i, m in enumerate(messages):
        s = message_size(m)
        if s > 1000:
            breakdown.append(f"  [{i}] {m.role} {s / 1024:.1f}KB")
    return pre_size, breakdown
