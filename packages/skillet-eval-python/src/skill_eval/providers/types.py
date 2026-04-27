from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field


class TokenUsage(BaseModel):
    input_tokens: int = Field(alias="inputTokens")
    output_tokens: int = Field(alias="outputTokens")

    model_config = {"populate_by_name": True}


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class Message(BaseModel):
    role: Literal["user", "assistant", "tool_result"]
    content: str = ""
    tool_calls: list[ToolCall] | None = Field(default=None, alias="toolCalls")
    tool_call_id: str | None = Field(default=None, alias="toolCallId")

    model_config = {"populate_by_name": True}


class ToolDefinition(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    content: str
    tool_calls: list[ToolCall] | None = Field(default=None, alias="toolCalls")
    usage: TokenUsage
    stop_reason: Literal["end", "tool_use", "max_tokens"] = Field(alias="stopReason")
    latency_ms: float = Field(alias="latencyMs")

    model_config = {"populate_by_name": True}


class ChatParams(BaseModel):
    system: str
    messages: list[Message]
    tools: list[ToolDefinition] | None = None
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, alias="maxTokens")

    model_config = {"populate_by_name": True}


StopReason = Literal["end", "tool_use", "max_tokens"]

ToolHandler = Callable[[dict[str, Any]], Awaitable[Any]]


class LLMProvider(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def model_id(self) -> str: ...

    async def chat(self, params: ChatParams) -> ChatResponse: ...
