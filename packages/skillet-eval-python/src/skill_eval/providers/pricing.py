from __future__ import annotations

import sys

PRICING: dict[str, tuple[float, float]] = {
    # Anthropic
    "claude-opus-4-6": (5.0, 25.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-sonnet-4-5": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    # OpenAI
    "gpt-5.4": (5.0, 22.5),
    "gpt-5.3-codex": (1.75, 14.0),
    "gpt-5.2": (1.75, 14.0),
    "gpt-5.2-codex": (1.75, 14.0),
    "o4-mini": (1.1, 4.4),
    # Google
    "gemini-3.1-pro-preview": (2.0, 12.0),
    "gemini-3-flash-preview": (0.5, 3.0),
    "gemini-3.1-flash-lite-preview": (0.25, 1.5),
}

_warned_models: set[str] = set()


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rate = PRICING.get(model)
    if rate is None:
        if model not in _warned_models:
            _warned_models.add(model)
            print(
                f"  ⚠ No pricing data for model \"{model}\" — cost will show as $0",
                file=sys.stderr,
            )
        return 0.0
    input_per_m, output_per_m = rate[0], rate[1]
    return (input_tokens / 1_000_000) * input_per_m + (
        output_tokens / 1_000_000
    ) * output_per_m
