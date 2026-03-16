from __future__ import annotations


def truncate(s: str, max_len: int, suffix: str = "…") -> str:
    if len(s) <= max_len:
        return s
    return f"{s[:max_len]}{suffix}"
