from __future__ import annotations

from pydantic import BaseModel

from skill_eval.providers.types import ToolDefinition


class BashParams(BaseModel):
    command: str


class ReadFileParams(BaseModel):
    path: str


class WriteFileParams(BaseModel):
    path: str
    content: str


class ListDirectoryParams(BaseModel):
    path: str


def _schema_from_model(model: type[BaseModel]) -> dict:
    schema = model.model_json_schema()
    return {
        "type": schema.get("type", "object"),
        "properties": schema.get("properties", {}),
        "required": schema.get("required", []),
    }


DEFAULT_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="bash",
        description="Run a bash command in the sandbox directory. Output is capped at 30KB. "
        "For large outputs, pipe through head, tail, or grep.",
        parameters=_schema_from_model(BashParams),
    ),
    ToolDefinition(
        name="read_file",
        description="Read the contents of a file. Files over 100KB are rejected — use bash "
        "with head/tail/grep to read specific parts of large files.",
        parameters=_schema_from_model(ReadFileParams),
    ),
    ToolDefinition(
        name="write_file",
        description="Write content to a file (creates parent directories if needed)",
        parameters=_schema_from_model(WriteFileParams),
    ),
    ToolDefinition(
        name="list_directory",
        description="List files and directories at the given path",
        parameters=_schema_from_model(ListDirectoryParams),
    ),
]
