from __future__ import annotations

import shutil
from pathlib import Path

SKIP_DIRS = frozenset({
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    ".env", "dist", "build", ".tox", ".mypy_cache", ".pytest_cache",
    "site-packages", ".npm", ".cache",
})

MAX_COLLECTED_FILE = 50 * 1024
MAX_TOTAL_COLLECTED = 200 * 1024


def seed_sandbox(sandbox_dir: str, skill_dir: str, files: list[str]) -> None:
    sandbox = Path(sandbox_dir)
    skill = Path(skill_dir)
    for file in files:
        src = (skill / file).resolve()
        dest = sandbox / Path(file).name
        if src.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)


def collect_output_files(sandbox_dir: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    total_size = 0
    sandbox = Path(sandbox_dir)

    def walk(dir_path: Path) -> None:
        nonlocal total_size
        if total_size >= MAX_TOTAL_COLLECTED:
            return
        try:
            entries = list(dir_path.iterdir())
        except OSError:
            return
        for entry in entries:
            if total_size >= MAX_TOTAL_COLLECTED:
                break
            if entry.is_dir():
                if entry.name in SKIP_DIRS:
                    continue
                walk(entry)
            else:
                try:
                    stat = entry.stat()
                    if stat.st_size > MAX_COLLECTED_FILE:
                        results.append({
                            "path": str(entry.relative_to(sandbox)),
                            "content": f"[file too large: {stat.st_size // 1024}KB]",
                        })
                        continue
                    content = entry.read_text(encoding="utf-8", errors="replace")
                    results.append({
                        "path": str(entry.relative_to(sandbox)),
                        "content": content,
                    })
                    total_size += len(content)
                except (OSError, UnicodeDecodeError):
                    pass

    walk(sandbox)
    return results
