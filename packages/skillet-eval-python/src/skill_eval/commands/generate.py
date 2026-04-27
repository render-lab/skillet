from __future__ import annotations

import json
from pathlib import Path

from rich.console import Console
from rich.prompt import Confirm, IntPrompt, Prompt

from skill_eval.config import load_config, resolve_skill_paths
from skill_eval.config.schema import CliOverrides
from skill_eval.providers.factory import create_provider
from skill_eval.schemas.evals import EvalsFile, get_turns
from skill_eval.utils.error import extract_error_message
from skill_eval.utils.json_utils import extract_json

MAX_REFERENCE_SIZE = 50_000

GENERATE_SYSTEM_PROMPT = """You generate eval test cases for AI agent skills. Given a skill's instructions and reference material, you produce a JSON file that defines test prompts and assertions.

Return ONLY valid JSON matching this exact structure (no other text):

{
  "skill_name": "<name from the skill>",
  "models": ["<model1>", "<model2>"],
  "evals": [
    {
      "id": 1,
      "prompt": "<a realistic user prompt that exercises a key capability>",
      "expected_output": "<description of what correct behavior looks like>",
      "files": [],
      "assertions": [
        "<specific, verifiable assertion about the agent's behavior>"
      ]
    }
  ]
}

For multi-turn conversations, use "turns" instead of "prompt":

{
  "id": 2,
  "turns": [
    "First user message — triggers the agent to ask a question",
    "User's reply to the agent's question"
  ],
  "expected_output": "...",
  "assertions": [...]
}

Use "turns" when the skill involves clarification, follow-up questions, or back-and-forth. Use "prompt" for single-turn tasks. Do NOT use both in the same eval.

Guidelines:
- Each eval should test a distinct capability of the skill
- Prompts should sound like a real user asking for help
- Assertions should be specific and objectively verifiable (not vague)
- Include 3-6 assertions per eval
- expected_output describes the ideal behavior, assertions are the checkable claims
- The "files" array is for input files the eval needs (usually empty)
- Use "turns" when the skill involves clarification, follow-up questions, ambiguous requests that need disambiguation, iterative refinement, or any back-and-forth. If the skill would reasonably involve the agent asking the user something before proceeding, model that as a multi-turn eval.
- When using "turns", the first message is intentionally vague or incomplete so the agent must ask a clarifying question. The second message is the user's reply. You can use 2-4 turns.
- When using "turns", assertions can reference behavior across turns (e.g., "After the user provides X, the agent does Y")
- A good eval suite mixes single-turn and multi-turn evals. Use multi-turn whenever the scenario naturally calls for it — don't force everything into a single prompt."""


def _build_generate_prompt(
    skill_content: str,
    references: list[dict[str, str]],
    count: int,
    models: list[str],
) -> str:
    prompt = f"""Generate {count} eval test cases for the following skill.

## Skill Instructions

{skill_content}"""

    if references:
        prompt += "\n\n## Reference Material\n"
        for ref in references:
            prompt += f"\n### {ref['name']}\n\n{ref['content']}\n"

    prompt += f"\n\nGenerate exactly {count} evals that cover the skill's most important capabilities. Each eval should test something different. Use multi-turn \"turns\" for any eval where the user's request is ambiguous, incomplete, or where the agent should ask for clarification before proceeding. Use single-turn \"prompt\" for straightforward tasks."
    prompt += f'\n\nSet the "models" field to: {json.dumps(models)}'

    return prompt


def _read_references(skill_dir: str) -> list[dict[str, str]]:
    refs_dir = Path(skill_dir) / "references"
    if not refs_dir.exists() or not refs_dir.is_dir():
        return []

    refs: list[dict[str, str]] = []
    for entry in refs_dir.iterdir():
        if entry.is_file() and entry.name.endswith(".md"):
            content = entry.read_text()
            if len(content) < MAX_REFERENCE_SIZE:
                refs.append({"name": entry.name, "content": content})
    return refs


async def run_generate(skill: str, count: int = 3, config_path: str | None = None) -> None:
    paths = resolve_skill_paths(skill)

    if not Path(paths["skill_file"]).exists():
        console = Console()
        console.print(f"[red]SKILL.md not found at {paths['skill_file']}[/red]")
        raise SystemExit(1)

    console = Console()
    console.print("\n[bold]skillet-eval generate[/bold]\n")

    config = load_config(CliOverrides(config_path=config_path))
    default_models = [p.model for p in config.providers]

    models_str = Prompt.ask(
        "Which models should evals run against? (comma-separated)",
        default=", ".join(default_models),
    )
    models = [m.strip() for m in models_str.split(",") if m.strip()]

    final_count = IntPrompt.ask("How many evals to generate?", default=count)
    if final_count < 1:
        final_count = count

    provider = create_provider(config.providers[0])

    console.print(f"Skill: [bold]{paths['skill_dir']}[/bold]")
    console.print(f"Generator: [bold]{provider.model_id}[/bold]")
    console.print(f"Models: [bold]{', '.join(models)}[/bold]")
    console.print(f"Count: [bold]{final_count}[/bold] eval(s)")

    skill_content = Path(paths["skill_file"]).read_text()
    references = _read_references(paths["skill_dir"])
    if references:
        console.print(f"Found {len(references)} reference file(s)")

    from skill_eval.runner.spinner import Spinner

    spinner = Spinner()
    spinner.start(f"Generating {final_count} eval(s) with {provider.model_id}")

    prompt = _build_generate_prompt(skill_content, references, final_count, models)

    from skill_eval.providers.types import ChatParams, Message

    response = await provider.chat(
        ChatParams(
            system=GENERATE_SYSTEM_PROMPT,
            messages=[Message(role="user", content=prompt)],
            temperature=0.3,
        )
    )

    spinner.stop()

    try:
        raw = json.loads(extract_json(response.content))
        evals_file = EvalsFile.model_validate(raw)
    except Exception as err:
        console.print(f"[red]Failed to parse generated evals: {extract_error_message(err)}[/red]")
        console.print(f"[dim]{response.content[:1000]}[/dim]")
        raise SystemExit(1) from None

    evals_file.models = models

    output_path = Path(paths["skill_dir"]) / "evals.json"
    write_path = output_path

    if output_path.exists() and not Confirm.ask(f"{output_path} already exists. Overwrite?"):
        write_path = Path(paths["skill_dir"]) / "evals.generated.json"

    write_path.write_text(evals_file.model_dump_json(indent=2) + "\n")
    console.print(f"[green]Wrote {write_path}[/green]")

    console.print()
    for eval_case in evals_file.evals:
        first_msg = get_turns(eval_case)[0] if get_turns(eval_case) else ""
        truncated = f"{first_msg[:80]}…" if len(first_msg) > 80 else first_msg
        console.print(f"  [bold]Eval {eval_case.id}[/bold]: {truncated}")
        for assertion in eval_case.assertions:
            console.print(f"    [dim]· {assertion}[/dim]")

    console.print(
        f"\n[green]{len(models)} model(s) configured · {len(evals_file.evals)} eval(s) generated[/green]\n"
    )
