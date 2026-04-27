from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import TypeVar

T = TypeVar("T")


async def with_timeout(
    coro: Coroutine[object, object, T],
    seconds: float,
    label: str,
) -> T:
    try:
        return await asyncio.wait_for(coro, timeout=seconds)
    except asyncio.TimeoutError:
        raise TimeoutError(f"{label} timed out after {seconds}s") from None
