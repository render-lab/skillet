from __future__ import annotations

from skill_eval.runner.tool_defs import (
    DEFAULT_TOOLS,
    BashParams,
    ListDirectoryParams,
    ReadFileParams,
    WriteFileParams,
)


class TestToolDefsJsonSchema:
    def test_bash_params_schema(self) -> None:
        schema = BashParams.model_json_schema()
        assert schema["type"] == "object"
        assert "command" in schema["properties"]
        assert schema["properties"]["command"]["type"] == "string"
        assert "command" in schema.get("required", [])

    def test_read_file_params_schema(self) -> None:
        schema = ReadFileParams.model_json_schema()
        assert schema["type"] == "object"
        assert "path" in schema["properties"]
        assert schema["properties"]["path"]["type"] == "string"
        assert "path" in schema.get("required", [])

    def test_write_file_params_schema(self) -> None:
        schema = WriteFileParams.model_json_schema()
        assert schema["type"] == "object"
        assert "path" in schema["properties"]
        assert "content" in schema["properties"]
        assert schema["properties"]["path"]["type"] == "string"
        assert schema["properties"]["content"]["type"] == "string"
        assert set(schema.get("required", [])) == {"path", "content"}

    def test_list_directory_params_schema(self) -> None:
        schema = ListDirectoryParams.model_json_schema()
        assert schema["type"] == "object"
        assert "path" in schema["properties"]
        assert schema["properties"]["path"]["type"] == "string"
        assert "path" in schema.get("required", [])

    def test_default_tools_have_valid_parameters(self) -> None:
        for tool in DEFAULT_TOOLS:
            params = tool.parameters
            assert "type" in params
            assert params["type"] == "object"
            assert "properties" in params
            assert isinstance(params["properties"], dict)
            assert "required" in params
            assert isinstance(params["required"], list)
