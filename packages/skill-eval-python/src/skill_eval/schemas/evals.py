from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class EvalCase(BaseModel):
    id: int
    prompt: str | None = None
    turns: list[str] | None = None
    expected_output: str
    files: list[str] = Field(default_factory=list)
    assertions: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def prompt_or_turns_required(self) -> EvalCase:
        if not self.prompt and not self.turns:
            raise ValueError("Either 'prompt' or 'turns' must be provided")
        if self.turns is not None and len(self.turns) < 1:
            raise ValueError("'turns' must have at least one element")
        return self

    @model_validator(mode="after")
    def prompt_and_turns_exclusive(self) -> EvalCase:
        if self.prompt and self.turns:
            raise ValueError(
                "'prompt' and 'turns' are mutually exclusive — use one or the other"
            )
        return self


class EvalsFile(BaseModel):
    skill_name: str
    models: list[str] | None = None
    evals: list[EvalCase] = Field(min_length=1)


def get_turns(eval_case: EvalCase) -> list[str]:
    if eval_case.turns:
        return eval_case.turns
    if eval_case.prompt:
        return [eval_case.prompt]
    return []
