from __future__ import annotations

import re


def extract_json(text: str) -> str:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fenced:
        return fenced.group(1).strip()
    braces = re.search(r"\{[\s\S]*\}", text)
    if braces:
        return braces.group(0)
    return text
