from __future__ import annotations

import os
import re
from pathlib import Path

from dotenv import load_dotenv as _load_dotenv_file

from .registry import ENV_KEY_MAP

_ENV_INTERPOLATION = re.compile(r"\$\{(\w+)\}")


def interpolate_env_vars(value: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        return os.environ.get(match.group(1), "")

    return _ENV_INTERPOLATION.sub(replacer, value)


def resolve_api_key(provider_name: str, explicit_key: str | None = None) -> str | None:
    if explicit_key:
        interpolated = interpolate_env_vars(explicit_key)
        if interpolated:
            return interpolated
    env_names = ENV_KEY_MAP.get(provider_name, [])
    for env_name in env_names:
        val = os.environ.get(env_name)
        if val:
            return val
    return None


def _find_up(filename: str, start_dir: str) -> Path | None:
    path = Path(start_dir).resolve()
    while True:
        candidate = path / filename
        if candidate.exists():
            return candidate
        parent = path.parent
        if parent == path:
            return None
        path = parent


def load_dotenv(dirs: list[str] | None = None) -> None:
    if dirs is None:
        dirs = [str(Path.cwd())]
    loaded: set[Path] = set()
    for start_dir in dirs:
        env_path = _find_up(".env", start_dir)
        if env_path is None or env_path in loaded:
            continue
        loaded.add(env_path)
        _load_dotenv_file(env_path)
