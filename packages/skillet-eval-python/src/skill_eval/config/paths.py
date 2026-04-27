from __future__ import annotations

from pathlib import Path

PROJECT_ROOT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml"]


def find_project_root(start_dir: str) -> str:
    dir_path = Path(start_dir).resolve()
    while True:
        for marker in PROJECT_ROOT_MARKERS:
            if (dir_path / marker).exists():
                return str(dir_path)
        parent = dir_path.parent
        if parent == dir_path:
            return str(Path(start_dir).resolve())
        dir_path = parent


def resolve_skill_paths(skill_path: str, evals_override: str | None = None) -> dict[str, str]:
    abs_path = Path(skill_path).resolve()
    skill_name = abs_path.name
    project_root = find_project_root(str(abs_path))
    evals_file = (
        str(Path(evals_override).resolve())
        if evals_override
        else str(abs_path / "evals.json")
    )
    return {
        "skill_dir": str(abs_path),
        "skill_name": skill_name,
        "skill_file": str(abs_path / "SKILL.md"),
        "evals_file": evals_file,
        "results_dir": str(Path(project_root) / ".skillet-evals" / "results" / skill_name),
    }
