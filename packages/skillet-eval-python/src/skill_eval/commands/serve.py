from __future__ import annotations

import json
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from rich.console import Console

from skill_eval.config import resolve_skill_paths
from skill_eval.report.html_reporter import write_dashboard

MIME_TYPES = {
    ".html": "text/html",
    ".json": "application/json",
    ".js": "application/javascript",
    ".css": "text/css",
}


def _make_handler(results_dir: Path):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(results_dir), **kwargs)

        def log_message(self, format, *args):
            pass

        def do_GET(self):
            from urllib.parse import urlparse

            parsed = urlparse(self.path)
            pathname = parsed.path

            if pathname == "/api/runs":
                files = sorted(
                    [f.name for f in results_dir.iterdir() if f.suffix == ".json" and f.name != "latest.json"],
                    reverse=True,
                )
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(json.dumps(files).encode())
                return

            if pathname in ("/", "/index.html"):
                write_dashboard(str(results_dir))
                pathname = "/index.html"

            file_path = results_dir / Path(pathname).name
            if file_path.exists() and file_path.is_file():
                ext = file_path.suffix
                self.send_response(200)
                self.send_header("Content-Type", MIME_TYPES.get(ext, "text/plain"))
                self.send_header(
                    "Cache-Control",
                    "no-cache" if ext == ".json" else "max-age=60",
                )
                self.end_headers()
                self.wfile.write(file_path.read_bytes())
                return

            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Not found")

    return Handler


def run_serve(skill: str, evals_path: str | None = None, port: int = 3000) -> None:
    paths = resolve_skill_paths(skill, evals_path)
    results_dir = Path(paths["results_dir"])

    if not results_dir.exists():
        results_dir.mkdir(parents=True, exist_ok=True)

    write_dashboard(str(results_dir))

    skill_name = Path(paths["skill_dir"]).name
    evals_file = Path(paths["evals_file"])
    if evals_file.exists():
        try:
            raw = json.loads(evals_file.read_text())
            if raw.get("skill_name"):
                skill_name = raw["skill_name"]
        except (json.JSONDecodeError, KeyError):
            pass

    handler = _make_handler(results_dir)
    server = HTTPServer(("", port), handler)

    console = Console()
    console.print("\n  [bold]skillet-eval serve[/bold]\n")
    console.print(f"  Skill:    {skill_name}")
    console.print(f"  Results:  {results_dir}")
    console.print()
    console.print(f"  [green]→[/green] [bold]http://localhost:{port}[/bold]")
    console.print("  [dim]Press Ctrl+C to stop[/dim]\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
