from __future__ import annotations

import asyncio
import math


def mean(arr: list[float]) -> float:
    return sum(arr) / len(arr) if arr else 0.0


def stddev(arr: list[float]) -> float:
    if len(arr) < 2:
        return 0.0
    m = mean(arr)
    variance = sum((v - m) ** 2 for v in arr) / (len(arr) - 1)
    return math.sqrt(variance)


async def sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)
