from __future__ import annotations

import json
import re


def extract_error_message(err: BaseException | object) -> str:
    if isinstance(err, Exception):
        return str(err)
    raw = str(err)
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and parsed.get("error", {}).get("message"):
            return parsed["error"]["message"]
    except (json.JSONDecodeError, TypeError):
        pass
    try:
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                if parsed.get("error", {}).get("message"):
                    return parsed["error"]["message"]
                if parsed.get("message"):
                    return parsed["message"]
    except (json.JSONDecodeError, TypeError):
        pass
    return f"{raw[:200]}…" if len(raw) > 200 else raw
