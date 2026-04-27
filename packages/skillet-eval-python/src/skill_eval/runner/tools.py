from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from skill_eval.providers.types import ToolHandler
from skill_eval.utils.error import extract_error_message

MAX_OUTPUT_CHARS = 30_000
MAX_FILE_SIZE = 100 * 1024


def truncate_output(output: str) -> str:
    if len(output) <= MAX_OUTPUT_CHARS:
        return output
    half = MAX_OUTPUT_CHARS // 2
    removed = len(output) - MAX_OUTPUT_CHARS
    return f"{output[:half]}\n\n... [{removed} characters truncated] ...\n\n{output[-half:]}"


def safe_path(sandbox_dir: str | Path, user_path: str) -> Path:
    sandbox = Path(sandbox_dir).resolve()
    resolved = (sandbox / user_path).resolve()
    try:
        resolved.relative_to(sandbox)
    except ValueError:
        raise ValueError(f"Path traversal blocked: {user_path}") from None
    return resolved


def create_tool_handlers(sandbox_dir: str | Path, timeout: int) -> dict[str, ToolHandler]:
    sandbox = Path(sandbox_dir).resolve()

    async def bash_handler(args: dict[str, Any]) -> dict[str, Any]:
        command = args.get("command", "")
        if not isinstance(command, str):
            return {"error": "command must be a string"}
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=sandbox,
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**dict(__import__("os").environ), "HOME": str(sandbox)},
            )
            output = (result.stdout or "").strip()
            if result.returncode != 0:
                err = (result.stderr or result.stdout or "Command failed").strip()
                return {"error": truncate_output(err)}
            return {"stdout": truncate_output(output)}
        except subprocess.TimeoutExpired:
            return {"error": f"Command timed out after {timeout}s"}
        except Exception as err:
            return {"error": truncate_output(extract_error_message(err))}

    async def read_file_handler(args: dict[str, Any]) -> dict[str, Any]:
        path_arg = args.get("path")
        if not isinstance(path_arg, str):
            return {"error": "path must be a string"}
        try:
            resolved = safe_path(sandbox, path_arg)
            stat = resolved.stat()
            if stat.st_size > MAX_FILE_SIZE:
                size_kb = round(stat.st_size / 1024)
                return {
                    "error": f"File is {size_kb}KB (limit: {MAX_FILE_SIZE // 1024}KB). "
                    "Use bash with head, tail, or grep to read specific parts."
                }
            return {"content": resolved.read_text(encoding="utf-8", errors="replace")}
        except Exception as err:
            return {"error": extract_error_message(err)}

    async def write_file_handler(args: dict[str, Any]) -> dict[str, Any]:
        path_arg = args.get("path")
        content = args.get("content")
        if not isinstance(path_arg, str):
            return {"error": "path must be a string"}
        if not isinstance(content, str):
            return {"error": "content must be a string"}
        try:
            resolved = safe_path(sandbox, path_arg)
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content, encoding="utf-8")
            return {"success": True}
        except Exception as err:
            return {"error": extract_error_message(err)}

    async def list_directory_handler(args: dict[str, Any]) -> dict[str, Any]:
        path_arg = args.get("path", ".")
        if not isinstance(path_arg, str):
            return {"error": "path must be a string"}
        try:
            resolved = safe_path(sandbox, path_arg or ".")
            entries = []
            for entry in resolved.iterdir():
                entries.append({
                    "name": entry.name,
                    "type": "directory" if entry.is_dir() else "file",
                })
            return {"entries": entries}
        except Exception as err:
            return {"error": extract_error_message(err)}

    return {
        "bash": bash_handler,
        "read_file": read_file_handler,
        "write_file": write_file_handler,
        "list_directory": list_directory_handler,
    }
