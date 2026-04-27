from __future__ import annotations

import asyncio

import pytest

from skill_eval.utils.async_utils import with_timeout
from skill_eval.utils.error import extract_error_message
from skill_eval.utils.json_utils import extract_json
from skill_eval.utils.math_utils import mean, stddev
from skill_eval.utils.rate import rate_level
from skill_eval.utils.string import truncate


class TestExtractJson:
    def test_extracts_json_from_markdown_fences(self) -> None:
        input_text = '```json\n{"key": "value"}\n```'
        assert extract_json(input_text) == '{"key": "value"}'

    def test_extracts_json_from_plain_fences(self) -> None:
        input_text = '```\n{"key": "value"}\n```'
        assert extract_json(input_text) == '{"key": "value"}'

    def test_extracts_json_from_braces_in_text(self) -> None:
        input_text = 'Here is the result: {"key": "value"} — done'
        assert extract_json(input_text) == '{"key": "value"}'

    def test_returns_text_as_is_when_no_json_found(self) -> None:
        input_text = "no json here"
        assert extract_json(input_text) == "no json here"


class TestMean:
    def test_computes_mean_of_numbers(self) -> None:
        assert mean([1, 2, 3]) == 2

    def test_returns_zero_for_empty_array(self) -> None:
        assert mean([]) == 0

    def test_handles_single_element(self) -> None:
        assert mean([5]) == 5


class TestStddev:
    def test_computes_standard_deviation(self) -> None:
        assert stddev([2, 4, 4, 4, 5, 5, 7, 9]) == pytest.approx(2.138, rel=1e-2)

    def test_returns_zero_for_single_element(self) -> None:
        assert stddev([5]) == 0

    def test_returns_zero_for_empty_array(self) -> None:
        assert stddev([]) == 0


class TestTruncate:
    def test_does_not_truncate_short_strings(self) -> None:
        assert truncate("hello", 10) == "hello"

    def test_truncates_long_strings_with_ellipsis(self) -> None:
        assert truncate("hello world", 5) == "hello…"

    def test_uses_custom_suffix(self) -> None:
        assert truncate("hello world", 5, "...") == "hello..."


class TestExtractErrorMessage:
    def test_extracts_message_from_error_instances(self) -> None:
        assert extract_error_message(Exception("test error")) == "test error"

    def test_handles_string_values(self) -> None:
        assert extract_error_message("raw string") == "raw string"

    def test_handles_none(self) -> None:
        assert extract_error_message(None) == "None"

    def test_truncates_very_long_messages(self) -> None:
        long_msg = "x" * 300
        result = extract_error_message(long_msg)
        assert len(result) < 300
        assert "…" in result


class TestWithTimeout:
    @pytest.mark.asyncio
    async def test_resolves_when_coro_completes_in_time(self) -> None:
        async def coro() -> int:
            return 42

        result = await with_timeout(coro(), 1.0, "test")
        assert result == 42

    @pytest.mark.asyncio
    async def test_rejects_when_times_out(self) -> None:
        async def slow_coro() -> None:
            await asyncio.sleep(5.0)

        with pytest.raises(TimeoutError, match="test op timed out"):
            await with_timeout(slow_coro(), 0.01, "test op")

    @pytest.mark.asyncio
    async def test_propagates_rejections(self) -> None:
        async def failing_coro() -> None:
            raise ValueError("inner")

        with pytest.raises(ValueError, match="inner"):
            await with_timeout(failing_coro(), 1.0, "test")


class TestRateLevel:
    def test_returns_green_for_high_rates(self) -> None:
        assert rate_level(0.9) == "green"
        assert rate_level(0.8) == "green"

    def test_returns_yellow_for_mid_rates(self) -> None:
        assert rate_level(0.7) == "yellow"
        assert rate_level(0.5) == "yellow"

    def test_returns_red_for_low_rates(self) -> None:
        assert rate_level(0.3) == "red"
        assert rate_level(0.0) == "red"
