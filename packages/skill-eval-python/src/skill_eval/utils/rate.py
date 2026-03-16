from __future__ import annotations

from collections.abc import Callable
from typing import Literal

HIGH_THRESHOLD = 0.8
MID_THRESHOLD = 0.5

RateLevel = Literal["green", "yellow", "red"]

_COLOR_MAP: dict[RateLevel, str] = {
    "green": "green",
    "yellow": "yellow",
    "red": "red",
}


def rate_level(rate: float) -> RateLevel:
    if rate >= HIGH_THRESHOLD:
        return "green"
    if rate >= MID_THRESHOLD:
        return "yellow"
    return "red"


def rate_color(rate: float) -> Callable[[str], str]:
    tag = _COLOR_MAP[rate_level(rate)]

    def formatter(s: str) -> str:
        return f"[{tag}]{s}[/{tag}]"

    return formatter
