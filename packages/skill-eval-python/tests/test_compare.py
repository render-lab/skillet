from __future__ import annotations

import pytest

from skill_eval.commands.compare import CompareResult, compare_benchmarks
from skill_eval.schemas.benchmark import ProviderSummary, Stats


def _make_summary(pass_rate: float) -> ProviderSummary:
    return ProviderSummary(
        pass_rate=Stats(mean=pass_rate, stddev=0),
        time_seconds=Stats(mean=5, stddev=1),
        total_tokens=Stats(mean=2000, stddev=100),
        cost_usd=Stats(mean=0.01, stddev=0.001),
    )


class TestCompareBenchmarks:
    def test_no_regression_when_rates_are_equal(self) -> None:
        golden = {"model-a": _make_summary(0.9)}
        current = {"model-a": _make_summary(0.9)}
        results = compare_benchmarks(golden, current)

        assert len(results) == 1
        assert results[0].regressed is False
        assert results[0].delta == 0

    def test_no_regression_when_rate_improves(self) -> None:
        golden = {"model-a": _make_summary(0.8)}
        current = {"model-a": _make_summary(1.0)}
        results = compare_benchmarks(golden, current)

        assert results[0].regressed is False
        assert results[0].delta == pytest.approx(0.2)

    def test_detects_single_provider_regression(self) -> None:
        golden = {
            "model-a": _make_summary(1.0),
            "model-b": _make_summary(0.9),
        }
        current = {
            "model-a": _make_summary(1.0),
            "model-b": _make_summary(0.7),
        }
        results = compare_benchmarks(golden, current)

        regressed = [r for r in results if r.regressed]
        assert len(regressed) == 1
        assert regressed[0].provider == "model-b"
        assert regressed[0].delta == pytest.approx(-0.2)

    def test_missing_provider_treated_as_regression(self) -> None:
        golden = {
            "model-a": _make_summary(0.9),
            "model-b": _make_summary(0.8),
        }
        current = {"model-a": _make_summary(0.9)}
        results = compare_benchmarks(golden, current)

        missing = next(r for r in results if r.provider == "model-b")
        assert missing.current_rate == 0
        assert missing.regressed is True

    def test_mixed_results_across_providers(self) -> None:
        golden = {
            "model-a": _make_summary(0.8),
            "model-b": _make_summary(0.9),
            "model-c": _make_summary(0.7),
        }
        current = {
            "model-a": _make_summary(0.9),
            "model-b": _make_summary(0.85),
            "model-c": _make_summary(0.7),
        }
        results = compare_benchmarks(golden, current)
        by_provider = {r.provider: r for r in results}

        assert by_provider["model-a"].regressed is False
        assert by_provider["model-b"].regressed is True
        assert by_provider["model-c"].regressed is False
