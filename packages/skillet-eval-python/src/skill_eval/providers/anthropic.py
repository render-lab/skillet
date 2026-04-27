from __future__ import annotations

import asyncio
import time
from typing import Any

from anthropic import Anthropic

from skill_eval.providers.base import BaseProvider, build_chat_response, normalize_chat_params
from skill_eval.providers.types import ChatParams, ChatResponse, ToolCall, ToolDefinition

STOP_MAP: dict[str, str] = {
    "end_turn": "end",
    "tool_use": "tool_use",
    "max_tokens": "max_tokens",
}


def _get_tool_schema(tool: ToolDefinition) -> dict[str, Any]:
    params = tool.parameters
    if isinstance(params, type) and hasattr(params, "model_json_schema"):
        return params.model_json_schema()
    if isinstance(params, dict) and params:
        return params
    return {"type": "object", "properties": {}}


def _format_tools(tools: list[ToolDefinition]) -> list[dict[str, Any]]:
    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": _get_tool_schema(t),
        }
        for t in tools
    ]


class AnthropicProvider(BaseProvider):
    def __init__(self, api_key: str, model: str) -> None:
        super().__init__(model)
        self._client = Anthropic(api_key=api_key)

    @property
    def name(self) -> str:
        return "anthropic"

    async def chat(self, params: ChatParams) -> ChatResponse:
        start = time.perf_counter()
        max_tokens, temperature = normalize_chat_params(params)

        messages: list[dict[str, Any]] = []
        for m in params.messages:
            if m.role == "tool_result":
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": m.tool_call_id or "",
                                "content": m.content,
                            }
                        ],
                    }
                )
            elif m.role == "assistant" and m.tool_calls:
                blocks: list[dict[str, Any]] = []
                if m.content:
                    blocks.append({"type": "text", "text": m.content})
                for tc in m.tool_calls:
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.name,
                            "input": tc.arguments,
                        }
                    )
                messages.append({"role": "assistant", "content": blocks})
            else:
                messages.append({"role": m.role, "content": m.content})

        def _create() -> Any:
            return self._client.messages.create(
                model=self.model_id,
                max_tokens=max_tokens,
                system=params.system,
                messages=messages,
                tools=_format_tools(params.tools) if params.tools else None,
                temperature=temperature,
            )

        response = await asyncio.to_thread(_create)

        content = ""
        tool_calls: list[ToolCall] = []
        for block in response.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.id,
                        name=block.name,
                        arguments=dict(block.input) if block.input else {},
                    )
                )

        latency_ms = (time.perf_counter() - start) * 1000
        stop_reason = STOP_MAP.get(response.stop_reason or "end_turn", "end")

        return build_chat_response(
            content=content,
            tool_calls=tool_calls,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            stop_reason=stop_reason,
            latency_ms=latency_ms,
        )
