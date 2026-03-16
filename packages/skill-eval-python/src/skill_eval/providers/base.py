from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal

from skill_eval.providers.types import (
    ChatParams,
    ChatResponse,
    TokenUsage,
    ToolCall,
)

DEFAULT_MAX_TOKENS = 8192
DEFAULT_TEMPERATURE = 0.0

StopReason = Literal["end", "tool_use", "max_tokens"]


def normalize_chat_params(params: ChatParams) -> tuple[int, float]:
    return (
        params.max_tokens if params.max_tokens is not None else DEFAULT_MAX_TOKENS,
        params.temperature if params.temperature is not None else DEFAULT_TEMPERATURE,
    )


def build_chat_response(
    *,
    content: str,
    tool_calls: list[ToolCall],
    input_tokens: int,
    output_tokens: int,
    stop_reason: StopReason,
    latency_ms: float,
) -> ChatResponse:
    return ChatResponse(
        content=content,
        tool_calls=tool_calls if tool_calls else None,
        usage=TokenUsage(input_tokens=input_tokens, output_tokens=output_tokens),
        stop_reason=stop_reason,
        latency_ms=latency_ms,
    )


class BaseProvider(ABC):
    def __init__(self, model: str) -> None:
        self._model_id = model

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def chat(self, params: ChatParams) -> ChatResponse: ...
