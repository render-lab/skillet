from __future__ import annotations

from skill_eval.providers.types import Message, ToolCall
from skill_eval.runner.context import (
    compact_messages,
    extract_snippet,
    message_size,
    summarize_tool_args,
)


class TestMessageSize:
    def test_counts_content_length(self) -> None:
        msg = Message(role="user", content="hello")
        assert message_size(msg) == 5

    def test_includes_tool_call_argument_sizes(self) -> None:
        msg = Message(
            role="assistant",
            content="ok",
            tool_calls=[ToolCall(id="1", name="bash", arguments={"command": "ls -la"})],
        )
        size = message_size(msg)
        assert size > 2


class TestExtractSnippet:
    def test_returns_first_meaningful_line(self) -> None:
        assert extract_snippet("# Header\n\nSome text here") == "Some text here"

    def test_skips_empty_lines_and_fences(self) -> None:
        assert extract_snippet("\n\n```python\ncode\n```\ntext") == "code"

    def test_returns_none_for_empty_content(self) -> None:
        assert extract_snippet("") is None

    def test_truncates_long_lines(self) -> None:
        long_line = "x" * 200
        result = extract_snippet(long_line)
        assert result is not None
        assert len(result) <= 81


class TestSummarizeToolArgs:
    def test_returns_command_for_bash(self) -> None:
        assert summarize_tool_args("bash", {"command": "ls"}) == "ls"

    def test_returns_path_for_file_tools(self) -> None:
        assert summarize_tool_args("read_file", {"path": "/foo/bar.txt"}) == "/foo/bar.txt"
        assert summarize_tool_args("write_file", {"path": "/out.txt", "content": "..."}) == "/out.txt"
        assert summarize_tool_args("list_directory", {"path": "/"}) == "/"

    def test_truncates_long_bash_commands(self) -> None:
        long_cmd = "x" * 100
        result = summarize_tool_args("bash", {"command": long_cmd})
        assert len(result) <= 61

    def test_falls_back_to_json_for_unknown_tools(self) -> None:
        result = summarize_tool_args("custom", {"a": 1})
        assert result == '{"a": 1}'


class TestCompactMessages:
    def test_does_not_modify_messages_under_budget(self) -> None:
        messages = [Message(role="user", content="hello")]
        compact_messages(messages, "system")
        assert messages[0].content == "hello"
