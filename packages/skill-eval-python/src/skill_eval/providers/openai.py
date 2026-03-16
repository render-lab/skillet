from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from openai import OpenAI

from skill_eval.providers.base import BaseProvider, build_chat_response, normalize_chat_params
from skill_eval.providers.types import ChatParams, ChatResponse, ToolCall, ToolDefinition

STOP_MAP: dict[str, str] = {
    "stop": "end",
    "tool_calls": "tool_use",
    "length": "max_tokens",
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
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": _get_tool_schema(t),
            },
        }
        for t in tools
    ]


class OpenAIProvider(BaseProvider):
    def __init__(self, api_key: str, model: str) -> None:
        super().__init__(model)
        self._client = OpenAI(api_key=api_key)

    @property
    def name(self) -> str:
        return "openai"

    async def chat(self, params: ChatParams) -> ChatResponse:
        start = time.perf_counter()
        max_tokens, temperature = normalize_chat_params(params)

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": params.system}
        ]

        for m in params.messages:
            if m.role == "tool_result":
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": m.tool_call_id or "",
                        "content": m.content,
                    }
                )
            elif m.role == "assistant" and m.tool_calls:
                messages.append(
                    {
                        "role": "assistant",
                        "content": m.content or None,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.name,
                                    "arguments": json.dumps(tc.arguments),
                                },
                            }
                            for tc in m.tool_calls
                        ],
                    }
                )
            else:
                messages.append({"role": m.role, "content": m.content})

        def _create() -> Any:
            return self._client.chat.completions.create(
                model=self.model_id,
                messages=messages,
                tools=_format_tools(params.tools) if params.tools else None,
                temperature=temperature,
                max_completion_tokens=max_tokens,
            )

        response = await asyncio.to_thread(_create)

        choice = response.choices[0]
        tool_calls: list[ToolCall] = []
        for tc in choice.message.tool_calls or []:
            if tc.type == "function":
                tool_calls.append(
                    ToolCall(
                        id=tc.id,
                        name=tc.function.name,
                        arguments=json.loads(tc.function.arguments or "{}"),
                    )
                )

        latency_ms = (time.perf_counter() - start) * 1000
        stop_reason = STOP_MAP.get(choice.finish_reason or "stop", "end")

        return build_chat_response(
            content=choice.message.content or "",
            tool_calls=tool_calls,
            input_tokens=response.usage.prompt_tokens if response.usage else 0,
            output_tokens=response.usage.completion_tokens if response.usage else 0,
            stop_reason=stop_reason,
            latency_ms=latency_ms,
        )
