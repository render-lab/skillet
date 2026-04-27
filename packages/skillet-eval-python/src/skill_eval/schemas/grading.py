from __future__ import annotations

from pydantic import BaseModel, Field


class ExpectationResult(BaseModel):
    text: str
    passed: bool
    evidence: str


class GradingResult(BaseModel):
    pass_rate: float = Field(ge=0, le=1)
    passed: int = Field(ge=0)
    failed: int = Field(ge=0)
    total: int = Field(ge=1)
    expectations: list[ExpectationResult]
    claims: list[str] = Field(default_factory=list)
    eval_feedback: str | None = None
