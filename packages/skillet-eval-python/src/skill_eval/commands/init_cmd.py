from __future__ import annotations

from pathlib import Path

import yaml
from rich.console import Console
from rich.prompt import Confirm, Prompt

from skill_eval.config import PROVIDER_REGISTRY, load_dotenv


def run_init() -> None:
    load_dotenv()

    console = Console()
    console.print("\n[bold]skillet-eval init[/bold]\n")

    detected: dict[str, str] = {}
    for provider, entry in PROVIDER_REGISTRY.items():
        import os

        for env_name in entry.env_keys:
            if os.environ.get(env_name):
                detected[provider] = env_name
                break

    if detected:
        lines = [f"[green]✓[/green] {p} ({env})" for p, env in detected.items()]
        console.print("Detected API keys:")
        for line in lines:
            console.print(f"  {line}")
        console.print()

    default = ", ".join(detected.keys()) if detected else ""
    providers_str = Prompt.ask(
        "Which providers do you want to configure? (comma-separated)",
        default=default,
    )
    selected = [p.strip() for p in providers_str.split(",") if p.strip()]

    providers: list[dict[str, str]] = []
    for name in selected:
        if name not in PROVIDER_REGISTRY:
            continue
        entry = PROVIDER_REGISTRY[name]
        default_model = entry.default_model

        if entry.models:
            console.print(f"\nModels for [bold]{entry.label}[/bold]:")
            for i, m in enumerate(entry.models, 1):
                default_marker = " [dim](default)[/dim]" if m.id == default_model else ""
                console.print(f"  {i}. {m.label} [dim]({m.tag})[/dim] — {m.id}{default_marker}")
            console.print(f"  {len(entry.models) + 1}. Custom model ID...")

            default_idx = next(
                (str(i) for i, m in enumerate(entry.models, 1) if m.id == default_model),
                "1",
            )
            choice = Prompt.ask("Select model", default=default_idx)
            try:
                idx = int(choice) - 1
                if 0 <= idx < len(entry.models):
                    model = entry.models[idx].id
                else:
                    model = Prompt.ask("Custom model ID", default=default_model)
            except ValueError:
                model = choice
        else:
            model = Prompt.ask(f"Model for {name}?", default=default_model)

        env_var = detected.get(name) or entry.env_keys[0] or f"{name.upper()}_API_KEY"
        providers.append({
            "name": name,
            "model": model or default_model,
            "apiKey": f"${{{env_var}}}",
        })

    grader_provider = selected[0] if selected else ""
    grader_entry = PROVIDER_REGISTRY.get(grader_provider)
    grader_model = next(
        (p["model"] for p in providers if p["name"] == grader_provider),
        grader_entry.default_model if grader_entry else "",
    )

    config = {
        "providers": providers,
        "grader": {
            "provider": grader_provider,
            "model": grader_model,
        },
        "settings": {
            "maxSteps": 20,
            "timeout": 300,
            "runsPerProvider": 1,
            "temperature": 0,
        },
    }

    yaml_str = yaml.dump(config, default_flow_style=False, sort_keys=False)
    output_path = Path("skillet.eval.yaml")

    if output_path.exists() and not Confirm.ask(f"{output_path} already exists. Overwrite?"):
        console.print("[yellow]Cancelled.[/yellow]")
        raise SystemExit(0)

    output_path.write_text(yaml_str)
    console.print(f"[green]✓ Wrote {output_path}[/green]\n")
