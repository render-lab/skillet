from __future__ import annotations

import asyncio
import time
from typing import Any

from google import genai
from google.genai import types

from skill_eval.providers.base import BaseProvider, build_chat_response, normalize_chat_params
from skill_eval.providers.types import ChatParams, ChatResponse, ToolCall, ToolDefinition

JSON_TO_GOOGLE_TYPE: dict[str, str] = {
    "object": "OBJECT",
    "string": "STRING",
    "number": "NUMBER",
    "boolean": "BOOLEAN",
    "array": "ARRAY",
    "integer": "INTEGER",
}


def _to_google_schema(schema: dict[str, Any]) -> dict[str, Any]:
    result = dict(schema)
    if isinstance(result.get("type"), str) and result["type"] in JSON_TO_GOOGLE_TYPE:
        result["type"] = JSON_TO_GOOGLE_TYPE[result["type"]]
    if "properties" in result and isinstance(result["properties"], dict):
        result["properties"] = {
            k: _to_google_schema(v) for k, v in result["properties"].items()
        }
    return result


def _get_tool_schema(tool: ToolDefinition) -> dict[str, Any]:
    params = tool.parameters
    if isinstance(params, type) and hasattr(params, "model_json_schema"):
        return _to_google_schema(params.model_json_schema())
    if isinstance(params, dict) and params:
        return _to_google_schema(params)
    return {"type": "OBJECT", "properties": {}}


def _format_tools(tools: list[ToolDefinition]) -> list[types.Tool]:
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name=t.name,
                    description=t.description,
                    parameters_json_schema=_get_tool_schema(t),
                )
                for t in tools
            ]
        )
    ]


class GoogleProvider(BaseProvider):
    def __init__(self, api_key: str, model: str) -> None:
        super().__init__(model)
        self._client = genai.Client(api_key=api_key)

    @property
    def name(self) -> str:
        return "google"

    async def chat(self, params: ChatParams) -> ChatResponse:
        start = time.perf_counter()
        max_tokens, temperature = normalize_chat_params(params)

        contents: list[types.Content] = []
        for m in params.messages:
            if m.role == "tool_result":
                contents.append(
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_function_response(
                                name=m.tool_call_id or "",
                                response={"result": m.content},
                            )
                        ],
                    )
                )
            elif m.role == "assistant" and m.tool_calls:
                parts: list[types.Part] = []
                if m.content:
                    parts.append(types.Part.from_text(text=m.content))
                for tc in m.tool_calls:
                    parts.append(
                        types.Part.from_function_call(
                            name=tc.name,
                            args=tc.arguments,
                        )
                    )
                contents.append(types.Content(role="model", parts=parts))
            else:
                role = "model" if m.role == "assistant" else "user"
                contents.append(
                    types.Content(
                        role=role,
                        parts=[types.Part.from_text(text=m.content)],
                    )
                )

        config = types.GenerateContentConfig(
            system_instruction=params.system,
            tools=_format_tools(params.tools) if params.tools else None,
            temperature=temperature,
            max_output_tokens=max_tokens,
        )

        def _generate() -> Any:
            return self._client.models.generate_content(
                model=self.model_id,
                contents=contents,
                config=config,
            )

        response = await asyncio.to_thread(_generate)

        text = response.text or ""
        tool_calls = [
            ToolCall(
                id=f"{fc.name}_{i}" if fc.name else f"call_{i}",
                name=fc.name or "",
                arguments=dict(fc.args) if fc.args else {},
            )
            for i, fc in enumerate(response.function_calls or [])
        ]

        has_tool_calls = len(tool_calls) > 0
        usage = response.usage_metadata

        stop_reason: str = "end"
        if has_tool_calls:
            stop_reason = "tool_use"
        elif response.candidates and response.candidates[0].finish_reason == "MAX_TOKENS":
            stop_reason = "max_tokens"

        latency_ms = (time.perf_counter() - start) * 1000

        return build_chat_response(
            content=text,
            tool_calls=tool_calls,
            input_tokens=usage.prompt_token_count if usage else 0,
            output_tokens=usage.candidates_token_count if usage else 0,
            stop_reason=stop_reason,
            latency_ms=latency_ms,
        )
