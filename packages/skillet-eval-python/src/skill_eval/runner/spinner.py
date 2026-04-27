from __future__ import annotations

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TaskID, TextColumn
from rich.status import Status

from skill_eval.utils.string import truncate

_console = Console()


def _elapsed(ms: float) -> str:
    s = int(ms / 1000)
    if s < 60:
        return f"{s}s"
    m = s // 60
    return f"{m}m{s % 60}s"


class Spinner:
    def __init__(self) -> None:
        self._progress: Progress | None = None
        self._status: Status | None = None
        self._tasks: dict[str, TaskID] = {}
        self._total = 0
        self._completed = 0
        self._simple_message = ""
        self._global_start: float = 0
        self._task_labels: dict[str, str] = {}
        self._task_details: dict[str, str] = {}

    def start(self, total_or_message: int | str = 0) -> None:
        import time

        self._global_start = time.monotonic() * 1000
        if isinstance(total_or_message, str):
            self._total = 1
            self._simple_message = total_or_message
        else:
            self._total = total_or_message
            self._simple_message = ""
        self._completed = 0
        self._tasks.clear()
        self._task_labels.clear()
        self._task_details.clear()

        if self._simple_message:
            self._status = Status(self._simple_message, console=_console, spinner="dots")
            self._status.start()
        else:
            self._progress = Progress(
                SpinnerColumn(),
                TextColumn("[bold blue]{task.description}"),
                console=_console,
            )
            self._progress.start()

    def track(self, id: str, label: str) -> None:
        self._task_labels[id] = label
        self._task_details[id] = ""
        if self._progress is not None:
            task_id = self._progress.add_task(label, total=None)
            self._tasks[id] = task_id

    def untrack(self, id: str) -> None:
        self._task_labels.pop(id, None)
        self._task_details.pop(id, None)
        if id in self._tasks and self._progress is not None:
            self._progress.remove_task(self._tasks[id])
            del self._tasks[id]

    def detail(self, id: str, text: str) -> None:
        self._task_details[id] = text
        if id in self._tasks and self._progress is not None:
            label = self._task_labels.get(id, id)
            detail = truncate(text, 60)
            self._progress.update(
                self._tasks[id],
                description=f"{label} · {detail}" if detail else label,
            )

    def succeed(self, id: str, line: str) -> None:
        self._completed += 1
        self.untrack(id)
        _console.print(line)

    def stop(self) -> None:
        if self._status is not None:
            self._status.stop()
            self._status = None
        if self._progress is not None:
            self._progress.stop()
            self._progress = None
